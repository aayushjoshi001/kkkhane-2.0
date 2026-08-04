'use server'

import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { validateInput, CreateTenantSchema } from '@/lib/validation'
import { ORDER_STATUS_TO_TAKEOUT, type OrderStatus } from '@/lib/takeout'
import {
    TIER_LIMITS,
    applyTierModuleDefaults,
    applyTierEntitlements,
    MODULE_KEYS,
    TIER_ENTITLEMENTS,
    type Tier,
} from '@/lib/tiers'
import { provisionRestaurant } from '@/lib/provisioning'

export interface CreateTenantInput {
    restaurantName: string
    restaurantSlug: string
    ownerFullName: string
    ownerEmail: string
    ownerPassword: string
    contactPhone?: string
    address?: string
    subscriptionTier: Tier
    businessType?: string
}

function normalizeSlug(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

export async function getAllRestaurants() {
    const supabase = await createAdminClient()
    
    try {
        const { data, error } = await supabase
            .from('restaurants')
            .select('*, settings(features_v2)')
            .order('created_at', { ascending: false })

        if (error) {
            console.error('getAllRestaurants error:', error)
            return { error: error.message, data: null }
        }

        const enrichedRestaurants = (data || []).map(r => {
            const settingsObj = Array.isArray(r.settings) ? r.settings[0] : r.settings
            const features = settingsObj?.features_v2 || {}
            return {
                ...r,
                features,
                financeEnabled: !!features.financeEnabled
            }
        })
        
        // If we have data, fetch owner emails separately if needed
        if (enrichedRestaurants.length > 0) {
            const ownerIds = enrichedRestaurants.filter(r => r.owner_id).map(r => r.owner_id)
            
            if (ownerIds.length > 0) {
                // Fetch each owner's email individually to avoid listUsers() pagination cap
                const emailMap = new Map<string, string | null>()
                await Promise.all(
                    ownerIds.map(async (id) => {
                        const { data: u } = await supabase.auth.admin.getUserById(id)
                        emailMap.set(id, u?.user?.email ?? null)
                    })
                )

                return {
                    data: enrichedRestaurants.map(r => ({
                        ...r,
                        users: r.owner_id ? { email: emailMap.get(r.owner_id) || null } : null
                    }))
                }
            }
        }
        
        return { data: enrichedRestaurants }
    } catch (err) {
        console.error('getAllRestaurants exception:', err)
        return { error: 'Failed to fetch restaurants', data: null }
    }
}

export async function suspendRestaurant(restaurantId: string, suspend: boolean) {
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('restaurants')
        .update({ is_suspended: suspend })
        .eq('id', restaurantId)

    if (error) return { error: error.message }

    revalidatePath('/admin/super-admin')
    return { success: true }
}

export async function updateSubscriptionTier(
    restaurantId: string,
    tier: Tier
) {
    const supabase = await createAdminClient()

    // Define limits per tier
    const limits = TIER_LIMITS[tier]

    // Read the plan being left behind first. UPDATE ... RETURNING hands back
    // the row as it now is, so the old tier is unrecoverable once the write has
    // happened — and it is what separates "this capability is new to you" from
    // "you had this and switched it off".
    const { data: previousRow } = await supabase
        .from('restaurants')
        .select('subscription_tier')
        .eq('id', restaurantId)
        .maybeSingle()
    const previousTier = previousRow?.subscription_tier

    const { error } = await supabase
        .from('restaurants')
        .update({
            subscription_tier: tier,
            max_staff: limits.max_staff,
            max_menu_items: limits.max_menu_items,
            max_tables: limits.max_tables,
        })
        .eq('id', restaurantId)

    if (error) return { error: error.message }

    // Apply the new plan's module entitlements to the stored flags.
    //
    // This previously only ran on a downgrade, and only for financeEnabled — so
    // moving a restaurant UP a plan changed its caps and nothing else. The
    // modules the customer had just paid for stayed absent from features_v2,
    // the server read absent as "off", and there was no way in the app to turn
    // them on. "Set to the package but the features still don't work" was
    // exactly this.
    //
    // applyTierModuleDefaults grants what the plan includes (respecting a flag
    // the tenant has deliberately switched off) and revokes what it does not,
    // which keeps the old downgrade protection.
    //
    // It only ever covered the three module flags, though, so the paid
    // capabilities — loyalty, inventory, shifts, dynamic pricing,
    // multi-language — kept whatever the original provisioning tier had
    // written. Every restaurant upgraded after signup was left with its old
    // plan's features. applyTierEntitlements re-grants those too, which is why
    // it needs the tier being left behind: a capability the old plan did not
    // cover is new and gets granted, while one it did cover keeps whatever the
    // tenant chose. Business mode no longer takes part — it seeds the flags
    // once at provisioning and does not get to overrule the tenant afterwards.
    const { data: settingsRow } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    if (settingsRow) {
        const current = (settingsRow.features_v2 || {}) as Record<string, unknown>
        const merged = applyTierEntitlements(applyTierModuleDefaults(current, tier), tier, previousTier)

        const changed = [...MODULE_KEYS, ...TIER_ENTITLEMENTS].some(
            key => current[key] !== merged[key as keyof typeof merged],
        )
        if (changed) {
            await supabase
                .from('settings')
                .update({ features_v2: merged })
                .eq('restaurant_id', restaurantId)

            // Invalidate Redis cache dynamically to avoid top-level module resolution issues
            try {
                const { invalidateCache } = await import('@/lib/redis')
                await invalidateCache(`features:${restaurantId}`)
            } catch (err) {
                console.error('Failed to invalidate feature cache after tier change:', err)
            }
            try {
                const { revalidateTag } = await import('next/cache')
                revalidateTag(`features-${restaurantId}`, 'max')
            } catch (err) {
                console.error('Failed to revalidate feature tag after tier change:', err)
            }
        }
    }

    revalidatePath('/admin/super-admin')
    return { success: true }
}

export async function createTenantWithOwner(input: CreateTenantInput) {
    await requireRole('super_admin')

    // Validate input against schema
    const validation = validateInput(CreateTenantSchema, input)
    if (!validation.success) {
        console.warn('Tenant creation validation failed:', validation.error)
        return { error: `Invalid input: ${validation.error}` }
    }

    const validatedInput = validation.data!
    const restaurantName = validatedInput.restaurantName.trim()
    const ownerFullName = validatedInput.ownerFullName.trim()
    const ownerEmail = validatedInput.ownerEmail.trim().toLowerCase()
    const ownerPassword = validatedInput.ownerPassword.trim()
    const restaurantSlug = normalizeSlug(validatedInput.restaurantSlug || validatedInput.restaurantName)
    const contactPhone = validatedInput.contactPhone?.trim() || null
    const address = validatedInput.address?.trim() || null
    const subscriptionTier: Tier = validatedInput.subscriptionTier || 'free'
    const businessType = validatedInput.businessType || null

    const supabase = await createAdminClient()

    const { data: existingRestaurant } = await supabase
        .from('restaurants').select('id').eq('slug', restaurantSlug).maybeSingle()

    if (existingRestaurant) {
        return { error: 'That restaurant slug is already in use.' }
    }

    const { data: createdAuthUser, error: createAuthError } = await supabase.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
        user_metadata: {
            full_name: ownerFullName,
        },
    })

    if (createAuthError || !createdAuthUser.user) {
        if (createAuthError?.message?.toLowerCase().includes('already registered') ||
            createAuthError?.message?.toLowerCase().includes('already been registered')) {
            return { error: 'That owner email already has an account.' }
        }
        return { error: createAuthError?.message || 'Failed to create owner auth account.' }
    }

    const authUserId = createdAuthUser.user.id

    // Shared canonical path: restaurant + owner users row (with email) + settings
    // + starter menu/tables/QR tokens + rollback on failure. This is what the
    // public signup and onboarding/create flows use too — previously this action
    // reimplemented all of it by hand (and never seeded tables/menu, so
    // /t/[qr_token] never worked for tenants created here).
    const result = await provisionRestaurant({
        ownerId: authUserId,
        ownerEmail,
        ownerName: ownerFullName,
        name: restaurantName,
        slug: restaurantSlug,
        contactPhone,
        address,
        tier: subscriptionTier,
        businessType,
        seedSample: true,
    })

    if (result.error || !result.restaurantId) {
        await supabase.auth.admin.deleteUser(authUserId)
        return { error: result.error || 'Failed to create tenant.' }
    }

    const { data: restaurant, error: fetchError } = await supabase
        .from('restaurants')
        .select('id, name, slug, is_active, is_suspended, subscription_tier, subscription_status, subscription_expires_at, max_staff, max_menu_items, created_at')
        .eq('id', result.restaurantId)
        .single()

    if (fetchError || !restaurant) {
        return { error: fetchError?.message || 'Restaurant created but failed to load its details.' }
    }

    revalidatePath('/admin/super-admin')

    return {
        success: true,
        restaurant: {
            ...restaurant,
            users: { email: ownerEmail },
        },
        owner: {
            id: authUserId,
            email: ownerEmail,
            full_name: ownerFullName,
        },
    }
}

export async function sendPasswordResetEmail(_userId: string, ownerEmail: string) {
    await requireRole('super_admin')

    const supabase = await createAdminClient()

    const { error } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: ownerEmail,
        options: {
            redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/login`,
        },
    })

    if (error) {
        return { error: error.message }
    }

    return {
        success: true,
        message: `Password reset link sent to ${ownerEmail}. They can use this link to set a new password.`,
    }
}

export async function updateOwnerContact(
    userId: string,
    updates: {
        email?: string
        phone?: string
    }
) {
    await requireRole('super_admin')

    const supabase = await createAdminClient()

    const updatePayload: Record<string, string | null> = {}
    if (updates.email) updatePayload.email = updates.email.trim().toLowerCase()
    if (updates.phone !== undefined) updatePayload.phone = updates.phone?.trim() || null

    const { error } = await supabase.auth.admin.updateUserById(userId, updatePayload as Parameters<typeof supabase.auth.admin.updateUserById>[1])

    if (error) {
        return { error: error.message }
    }

    revalidatePath('/admin/super-admin')
    return { success: true }
}

export async function recordSubscriptionPayment(
    restaurantId: string,
    amount: number,
    paymentMethod: string,
    referenceCode: string,
    notes: string
) {
    const currentUser = await requireRole('super_admin')
    const supabase = await createAdminClient()

    // Insert payment record
    const { error: paymentError } = await supabase
        .from('subscription_payments')
        .insert({
            restaurant_id: restaurantId,
            amount,
            payment_method: paymentMethod,
            reference_code: referenceCode || null,
            notes: notes || null,
            recorded_by: currentUser.id,
        })

    if (paymentError) return { error: paymentError.message }

    // Extend subscription by 30 days from today (or from current expiry if in the future)
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('subscription_expires_at')
        .eq('id', restaurantId)
        .single()

    const base = restaurant?.subscription_expires_at
        ? new Date(Math.max(new Date(restaurant.subscription_expires_at).getTime(), Date.now()))
        : new Date()
    const newExpiry = new Date(base)
    newExpiry.setDate(newExpiry.getDate() + 30)

    const { error: updateError } = await supabase
        .from('restaurants')
        .update({
            subscription_expires_at: newExpiry.toISOString(),
            subscription_status: 'active',
        })
        .eq('id', restaurantId)

    if (updateError) return { error: updateError.message }

    revalidatePath('/admin/super-admin')
    return { success: true, newExpiry: newExpiry.toISOString() }
}

/**
 * Suspend all restaurants whose subscription has expired.
 * Safe to call repeatedly — only affects non-suspended restaurants.
 */
export async function runSubscriptionAutoSuspend(): Promise<{
    error?: string
    suspended?: { id: string; name: string }[]
}> {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .rpc('auto_suspend_expired_subscriptions')

    if (error) return { error: error.message }

    revalidatePath('/admin/super-admin')
    return { suspended: (data as { suspended_id: string; suspended_name: string }[] | null)?.map(r => ({ id: r.suspended_id, name: r.suspended_name })) || [] }
}

export async function getSaasMetrics() {
    const supabase = await createAdminClient()

    const [
        { count: totalRestaurants },
        { count: activeRestaurants },
        { count: totalOrders },
        { data: tierBreakdown },
    ] = await Promise.all([
        supabase.from('restaurants').select('*', { count: 'exact', head: true }),
        supabase.from('restaurants').select('*', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('restaurants').select('subscription_tier'),
    ])

    const tiers: Record<string, number> = { free: 0, basic: 0, premium: 0, platinum: 0, enterprise: 0 }
    tierBreakdown?.forEach((r: { subscription_tier?: string }) => {
        const tier = r.subscription_tier || 'free'
        tiers[tier] = (tiers[tier] || 0) + 1
    })

    return {
        totalRestaurants: totalRestaurants || 0,
        activeRestaurants: activeRestaurants || 0,
        totalOrders: totalOrders || 0,
        tierBreakdown: tiers,
    }
}

// ============================================================
// Cross-Tenant Query Actions (super_admin only)
// ============================================================

export async function getSaasMetricsFull() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()

    const [
        { count: totalRestaurants },
        { count: activeRestaurants },
        { count: totalOrders },
        { data: tierData },
        { data: suspendedData },
        { data: mrrData },
        { data: recentTenants },
        { data: recentOrders30 },
        { data: expiringData },
    ] = await Promise.all([
        supabase.from('restaurants').select('*', { count: 'exact', head: true }),
        supabase.from('restaurants').select('*', { count: 'exact', head: true }).eq('is_active', true).eq('is_suspended', false),
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('restaurants').select('id, name, subscription_tier, subscription_expires_at'),
        supabase.from('restaurants').select('id').eq('is_suspended', true),
        supabase.from('subscription_payments').select('amount').gte('created_at', thirtyDaysAgo),
        supabase.from('restaurants').select('id, name, subscription_tier, created_at').order('created_at', { ascending: false }).limit(5),
        supabase.from('orders').select('restaurant_id, total_amount').gte('placed_at', thirtyDaysAgo),
        supabase.from('restaurants').select('id, name, subscription_expires_at').not('subscription_expires_at', 'is', null),
    ])

    const tiers: Record<string, number> = { free: 0, basic: 0, premium: 0, platinum: 0, enterprise: 0 }
    ;(tierData || []).forEach((r: { subscription_tier?: string }) => {
        const t = r.subscription_tier || 'free'
        tiers[t] = (tiers[t] || 0) + 1
    })

    const mrr = (mrrData || []).reduce((s: number, p: { amount: number }) => s + (p.amount || 0), 0)

    // Top 5 restaurants by order count (last 30 days)
    const orderCountMap: Record<string, { count: number; revenue: number }> = {}
    for (const o of (recentOrders30 || []) as Array<{ restaurant_id: string; total_amount: number }>) {
        if (!orderCountMap[o.restaurant_id]) orderCountMap[o.restaurant_id] = { count: 0, revenue: 0 }
        orderCountMap[o.restaurant_id].count++
        orderCountMap[o.restaurant_id].revenue += o.total_amount || 0
    }
    // Enrich with restaurant names
    const restaurantIds = Object.keys(orderCountMap)
    const restaurantNames: Record<string, string> = {}
    if (restaurantIds.length > 0) {
        const { data: rNames } = await supabase.from('restaurants').select('id, name').in('id', restaurantIds)
        for (const r of (rNames || []) as Array<{ id: string; name: string }>) {
            restaurantNames[r.id] = r.name
        }
    }
    const top5 = Object.entries(orderCountMap)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([id, stats]) => ({ id, name: restaurantNames[id] || id.slice(0, 8), ...stats }))

    // Expiring within 7 days
    const now = Date.now()
    const expiringSoon = (expiringData || []).filter((r: { subscription_expires_at: string | null }) => {
        if (!r.subscription_expires_at) return false
        const diff = new Date(r.subscription_expires_at).getTime() - now
        return diff > 0 && diff < 7 * 24 * 3600 * 1000
    }) as Array<{ id: string; name: string; subscription_expires_at: string }>

    return {
        totalRestaurants: totalRestaurants || 0,
        activeRestaurants: activeRestaurants || 0,
        suspendedRestaurants: (suspendedData || []).length,
        totalOrders: totalOrders || 0,
        tierBreakdown: tiers,
        mrr,
        recentTenants: (recentTenants || []) as Array<{ id: string; name: string; subscription_tier: string; created_at: string }>,
        top5ByOrders: top5,
        expiringSoon,
    }
}

export async function getAllOrdersAcrossRestaurants(limit = 200) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('orders')
        .select('id, restaurant_id, total_amount, status, placed_at, payment_status, session_id, restaurants(name), sessions(tables(label))')
        .order('placed_at', { ascending: false })
        .limit(limit)

    if (error) return { error: error.message, data: null }
    return { data }
}

export async function getAllStaffAcrossRestaurants() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('users')
        .select('id, full_name, is_active, restaurant_id, role_id, restaurants(name, subscription_tier), roles(name)')
        .neq('role_id', 5)
        .order('restaurant_id')

    if (error) return { error: error.message, data: null }

    // Fetch emails from auth
    const userIds = (data || []).map((u: { id: string }) => u.id)
    const emailMap: Record<string, string> = {}
    await Promise.all(
        userIds.map(async (id: string) => {
            const { data: authUser } = await supabase.auth.admin.getUserById(id)
            emailMap[id] = authUser?.user?.email || ''
        })
    )

    const enriched = (data || []).map((u: Record<string, unknown>) => ({
        ...u,
        email: emailMap[u.id as string] || '',
    }))

    return { data: enriched }
}

export async function getAllMenusAcrossRestaurants() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const [{ data: restaurants }, { data: items }] = await Promise.all([
        supabase.from('restaurants').select('id, name, subscription_tier').eq('is_active', true).order('name'),
        supabase.from('menu_items').select('id, name, price, is_available, restaurant_id, category_id, menu_categories(name)').order('restaurant_id'),
    ])

    if (!restaurants) return { data: null }

    // Group items by restaurant
    const itemsByRestaurant: Record<string, typeof items> = {}
    for (const item of (items || []) as Array<{ restaurant_id: string }>) {
        if (!itemsByRestaurant[item.restaurant_id]) itemsByRestaurant[item.restaurant_id] = []
        itemsByRestaurant[item.restaurant_id]!.push(item as never)
    }

    const grouped = (restaurants as Array<{ id: string; name: string; subscription_tier: string }>).map(r => ({
        ...r,
        items: itemsByRestaurant[r.id] || [],
        totalItems: (itemsByRestaurant[r.id] || []).length,
        availableItems: (itemsByRestaurant[r.id] || []).filter((i: { is_available: boolean }) => i.is_available).length,
    }))

    return { data: grouped }
}

export async function getAllTablesAcrossRestaurants() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const [{ data: tables }, { data: activeSessions }] = await Promise.all([
        supabase.from('tables').select('id, label, capacity, qr_token, is_active, restaurant_id, restaurants(name)').order('restaurant_id').order('label'),
        supabase.from('sessions').select('table_id').eq('status', 'active'),
    ])

    if (!tables) return { data: null }

    const activeTableIds = new Set((activeSessions || []).map((s: { table_id: string }) => s.table_id))

    const enriched = (tables as unknown as Array<{ id: string; label: string; capacity: number | null; qr_token: string; is_active: boolean; restaurant_id: string; restaurants: { name: string } | null }>)
        .map(t => ({ ...t, hasActiveSession: activeTableIds.has(t.id) }))

    return { data: enriched }
}

export async function getAllTakeoutOrdersAcrossRestaurants(limit = 100) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    // Takeout now lives in the unified orders table (order_type='takeout').
    const { data, error } = await supabase
        .from('orders')
        .select('id, restaurant_id, customer_name, customer_phone, status, total_amount, placed_at, payment_status, restaurants(name)')
        .eq('order_type', 'takeout')
        .order('placed_at', { ascending: false })
        .limit(limit)

    if (error) return { error: error.message, data: null }

    // Map order_status back to takeout-status labels for the existing UI.
    const mapped = (data || []).map((o) => ({
        ...o,
        status: ORDER_STATUS_TO_TAKEOUT[o.status as OrderStatus] ?? o.status,
    }))
    return { data: mapped }
}

export async function getAllSubscriptionPayments(limit = 100) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('subscription_payments')
        .select('id, restaurant_id, amount, payment_method, reference_code, notes, created_at, recorded_by, restaurants(name, subscription_tier, subscription_expires_at, subscription_status)')
        .order('created_at', { ascending: false })
        .limit(limit)

    if (error) return { error: error.message, data: null }
    return { data }
}

export async function getAllPromoCodesAcrossRestaurants() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('promo_codes')
        .select('id, restaurant_id, code, promo_type, value, current_uses, max_uses, valid_until, is_active, restaurants(name)')
        .order('restaurant_id')
        .order('created_at', { ascending: false })

    if (error) return { error: error.message, data: null }
    return { data }
}

export async function getAllLoyaltyOverview() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const [{ data: configs }, { data: memberCounts }] = await Promise.all([
        supabase.from('loyalty_config').select('restaurant_id, points_per_dollar, redemption_threshold, redemption_value, is_active, restaurants(name, subscription_tier)'),
        supabase.from('loyalty_members').select('restaurant_id'),
    ])

    if (!configs) return { data: null }

    const countByRestaurant: Record<string, number> = {}
    for (const m of (memberCounts || []) as Array<{ restaurant_id: string }>) {
        countByRestaurant[m.restaurant_id] = (countByRestaurant[m.restaurant_id] || 0) + 1
    }

    const enriched = (configs as unknown as Array<{ restaurant_id: string; points_per_dollar: number; redemption_threshold: number; redemption_value: number; is_active: boolean; restaurants: { name: string; subscription_tier: string } | null }>)
        .map(c => ({ ...c, memberCount: countByRestaurant[c.restaurant_id] || 0 }))

    return { data: enriched }
}

export async function getAllPricingRulesOverview() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const [{ data: rules }, { data: settings }] = await Promise.all([
        supabase.from('pricing_rules').select('restaurant_id, is_active'),
        supabase.from('settings').select('restaurant_id, features_v2, restaurants(name, subscription_tier)'),
    ])

    if (!settings) return { data: null }

    // Count active rules per restaurant
    const activeRulesMap: Record<string, number> = {}
    for (const r of (rules || []) as Array<{ restaurant_id: string; is_active: boolean }>) {
        if (r.is_active) {
            activeRulesMap[r.restaurant_id] = (activeRulesMap[r.restaurant_id] || 0) + 1
        }
    }

    const enriched = (settings as unknown as Array<{
        restaurant_id: string
        features_v2: { dynamicPricingEnabled?: boolean }
        restaurants: { name: string; subscription_tier: string } | null
    }>).map(s => ({
        restaurant_id: s.restaurant_id,
        restaurant: s.restaurants,
        dynamicPricingEnabled: s.features_v2?.dynamicPricingEnabled || false,
        activeRules: activeRulesMap[s.restaurant_id] || 0,
    }))

    return { data: enriched }
}

export async function getAllEodReportsAcrossRestaurants(limit = 100) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('eod_reports')
        .select('id, restaurant_id, report_date, total_orders, total_revenue, avg_order_value, created_at, restaurants(name)')
        .order('report_date', { ascending: false })
        .limit(limit)

    if (error) return { error: error.message, data: null }
    return { data }
}

export async function getAllIngredientsAcrossRestaurants() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('ingredients')
        .select('id, restaurant_id, name, unit, stock_quantity, reorder_level, is_active, restaurants(name)')
        .eq('is_active', true)
        .order('restaurant_id')
        .order('name')

    if (error) return { error: error.message, data: null }
    return { data }
}

export async function getAllShiftsAcrossRestaurants(limit = 100) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const [{ data: active }, { data: recent }] = await Promise.all([
        supabase
            .from('staff_shifts')
            .select('id, user_id, restaurant_id, clock_in, clock_out, hours_worked, restaurants(name), users(full_name, roles(name))')
            .is('clock_out', null)
            .order('clock_in', { ascending: false }),
        supabase
            .from('staff_shifts')
            .select('id, user_id, restaurant_id, clock_in, clock_out, hours_worked, restaurants(name), users(full_name, roles(name))')
            .not('clock_out', 'is', null)
            .order('clock_in', { ascending: false })
            .limit(limit),
    ])

    return { activeShifts: active || [], recentShifts: recent || [] }
}

export async function getPlatformAnalytics() {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000)

    const [
        { data: paymentHistory },
        { data: orders30 },
        { data: allRestaurants },
        { data: newTenants },
    ] = await Promise.all([
        // Subscription payments for MRR chart (12 months)
        supabase.from('subscription_payments').select('amount, created_at').gte('created_at', new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString()).order('created_at'),
        // Orders last 30 days for revenue/volume per restaurant
        supabase.from('orders').select('restaurant_id, total_amount, placed_at').gte('placed_at', thirtyDaysAgo.toISOString()),
        // All restaurants for tier breakdown
        supabase.from('restaurants').select('id, name, subscription_tier, subscription_status, is_suspended, created_at'),
        // New tenant signups by month (last 6 months)
        supabase.from('restaurants').select('created_at').gte('created_at', sixMonthsAgo.toISOString()),
    ])

    // Build monthly MRR buckets (last 12 months)
    const mrrByMonth: Record<string, number> = {}
    for (const p of (paymentHistory || []) as Array<{ amount: number; created_at: string }>) {
        const month = p.created_at.slice(0, 7) // YYYY-MM
        mrrByMonth[month] = (mrrByMonth[month] || 0) + (p.amount || 0)
    }

    // Orders per restaurant (last 30 days)
    const orderStatsMap: Record<string, { count: number; revenue: number }> = {}
    for (const o of (orders30 || []) as Array<{ restaurant_id: string; total_amount: number }>) {
        if (!orderStatsMap[o.restaurant_id]) orderStatsMap[o.restaurant_id] = { count: 0, revenue: 0 }
        orderStatsMap[o.restaurant_id].count++
        orderStatsMap[o.restaurant_id].revenue += o.total_amount || 0
    }

    // Enrich with restaurant names
    const restaurantStatsArray = ((allRestaurants || []) as Array<{ id: string; name: string; subscription_tier: string; subscription_status: string; is_suspended: boolean; created_at: string }>)
        .map(r => ({
            id: r.id,
            name: r.name,
            tier: r.subscription_tier,
            status: r.subscription_status,
            isSuspended: r.is_suspended,
            orders30d: orderStatsMap[r.id]?.count || 0,
            revenue30d: orderStatsMap[r.id]?.revenue || 0,
        }))
        .sort((a, b) => b.orders30d - a.orders30d)

    // New tenants by month
    const tenantsByMonth: Record<string, number> = {}
    for (const t of (newTenants || []) as Array<{ created_at: string }>) {
        const month = t.created_at.slice(0, 7)
        tenantsByMonth[month] = (tenantsByMonth[month] || 0) + 1
    }

    return {
        mrrByMonth,
        restaurantStats: restaurantStatsArray,
        tenantsByMonth,
    }
}

export async function toggleRestaurantFinance(restaurantId: string, enabled: boolean) {
    await requireRole('super_admin')
    
    // We import features dynamically or just execute updateFeaturesAction
    const { updateFeaturesAction } = await import('@/lib/features')
    const result = await updateFeaturesAction(restaurantId, { financeEnabled: enabled })
    if (result.error) return { error: result.error }

    revalidatePath('/admin/super-admin')
    return { success: true }
}

export async function updateRestaurantFeatures(restaurantId: string, features: any) {
    await requireRole('super_admin')

    const supabase = await createAdminClient()

    const { data: settingsRow } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .maybeSingle()

    const currentFeatures = settingsRow?.features_v2 || {}
    const mergedFeatures = { ...currentFeatures, ...features }

    const { error } = await supabase
        .from('settings')
        .update({ features_v2: mergedFeatures })
        .eq('restaurant_id', restaurantId)

    if (error) {
        console.error('updateRestaurantFeatures error:', error)
        return { error: error.message }
    }

    try {
        const { invalidateCache } = await import('@/lib/redis')
        await invalidateCache(`features:${restaurantId}`)
    } catch (err) {
        console.error('Failed to invalidate Redis cache:', err)
    }

    try {
        const { revalidateTag } = await import('next/cache')
        revalidateTag(`features-${restaurantId}`, 'max')
        revalidateTag(`mode-${restaurantId}`, 'max')
    } catch (err) {
        console.error('Failed to invalidate NextCache tags:', err)
    }

    revalidatePath('/admin/super-admin')
    revalidatePath('/admin/settings')
    revalidatePath('/waiter')
    return { success: true }
}

// ============================================================
// System Advertisements Management
// ============================================================

export async function getSystemAdvertisementsAction() {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('system_advertisements')
        .select('*')
        .order('created_at', { ascending: true })

    if (error) {
        // Fallback to static ads if table doesn't exist yet
        return {
            data: [
                {
                    id: '1',
                    badge: 'NEW INTEGRATION',
                    title: 'Supercharge Room Bookings with Booking.com Sync',
                    description: 'Connect your hotel rooms directory directly to online travel agents for automatic real-time rate updates and zero overbookings.',
                    cta: 'Connect Channels',
                    link: '/admin/settings'
                },
                {
                    id: '2',
                    badge: 'HARDWARE CORNER',
                    title: 'Auto-Print KOTs to Your Thermal Printer',
                    description: 'Point your 80mm LAN printer at the cashier counter and KOT tickets print the moment an order is confirmed. No manual reprints.',
                    cta: 'Set Up Printer',
                    link: '/admin/printers'
                },
                {
                    id: '3',
                    badge: 'SRMS PLATINUM',
                    title: 'Auto-Backup Data to Google Drive & Dropbox',
                    description: 'Never worry about server outages or laptop loss. Keep encrypted hourly database backups synced automatically to your own cloud storage.',
                    cta: 'Enable Backups',
                    link: '/admin/profile'
                }
            ]
        }
    }
    return { data: data || [] }
}

export async function saveSystemAdvertisementAction(ad: {
    id?: string
    badge: string
    title: string
    description: string
    cta: string
    link: string
}) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    if (ad.id) {
        const { data, error } = await supabase
            .from('system_advertisements')
            .update({
                badge: ad.badge,
                title: ad.title,
                description: ad.description,
                cta: ad.cta,
                link: ad.link
            })
            .eq('id', ad.id)
            .select()
            .single()

        if (error) return { error: error.message }
        return { data }
    } else {
        const { data, error } = await supabase
            .from('system_advertisements')
            .insert({
                badge: ad.badge,
                title: ad.title,
                description: ad.description,
                cta: ad.cta,
                link: ad.link
            })
            .select()
            .single()

        if (error) return { error: error.message }
        return { data }
    }
}

export async function deleteSystemAdvertisementAction(id: string) {
    await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { error } = await supabase
        .from('system_advertisements')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    return { success: true }
}
