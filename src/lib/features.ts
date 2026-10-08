'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import type { Settings, Restaurant } from '@/types/database'
import { getBusinessMode, type BusinessMode } from '@/lib/businessMode'
import { effectiveTier, isTrialing } from '@/lib/trial'
import {
    applyTierModuleDefaults,
    applyTierEntitlements,
    resolveFeatureDefaults,
    tierIncludesModule,
    tierIncludesEntitlement,
    MODULE_KEYS,
    TIER_ENTITLEMENTS,
    TIER_MODULES,
    type ModuleKey,
    type TierEntitlement,
} from '@/lib/tiers'
import { fetchWithCache, invalidateCache } from '@/lib/redis'
import { unstable_cache, revalidateTag, revalidatePath } from 'next/cache'

/**
 * Fetch features_v2 flags for a restaurant.
 * Cached for 30 seconds across requests — features change rarely and this
 * was previously hitting the DB on every kitchen/waiter/admin page load.
 */
export async function getRestaurantFeatures(restaurantId: string): Promise<Settings['features_v2'] | null> {
    if (!restaurantId) return null
    try {
        const fetcher = unstable_cache(
            async () => {
                return fetchWithCache(`features:${restaurantId}`, async () => {
                    const supabase = await createAdminClient()
                    // The plan is read alongside the flags because a module the
                    // stored settings never wrote has to be resolved from the
                    // tier. Without it an absent key reads as "off" here and
                    // "on" in the client, which is what put a link in the
                    // sidebar to a page that redirected straight back.
                    const [{ data: settings }, { data: restaurant }] = await Promise.all([
                        supabase
                            .from('settings')
                            .select('features_v2')
                            .eq('restaurant_id', restaurantId)
                            .maybeSingle(),
                        supabase
                            .from('restaurants')
                            // Status and expiry ride along so a trial that ran
                            // out stops granting its plan straight away. The
                            // nightly cron is what writes the downgrade down,
                            // but it runs once a day — resolving it here too is
                            // what stops the hours in between being free
                            // platinum. Same row, no extra round-trip.
                            .select('subscription_tier, subscription_status, subscription_expires_at')
                            .eq('id', restaurantId)
                            .maybeSingle(),
                    ])
                    if (!settings?.features_v2) return null
                    const tier = effectiveTier(
                        restaurant?.subscription_tier,
                        restaurant?.subscription_status,
                        restaurant?.subscription_expires_at,
                    )
                    // resolveFeatureDefaults fills the non-module flags an older
                    // provisioning never wrote. Without it the client read an
                    // absent key as on and the server page gate read it as off,
                    // so e.g. Manual Finance Entry showed as enabled in settings
                    // and still bounced the tenant off /admin/manual-entry.
                    //
                    // applyTierEntitlements revokes the paid capabilities a
                    // lapsed trial no longer covers; on any live plan the tier
                    // is unchanged and it is a no-op.
                    const trialing = isTrialing(
                        restaurant?.subscription_status,
                        restaurant?.subscription_expires_at,
                    )
                    const base = resolveFeatureDefaults(settings.features_v2 as Record<string, unknown>)
                    if (trialing) {
                        // During an active trial the stored features_v2 may have
                        // been written for 'free' (backfilled accounts). Grant
                        // every entitlement and module unconditionally — a stored
                        // 'false' here was never a conscious choice, and a trial
                        // that promises full access cannot let it block anything.
                        for (const key of TIER_ENTITLEMENTS) {
                            (base as Record<string, unknown>)[key] = true
                        }
                        for (const key of MODULE_KEYS) {
                            (base as Record<string, unknown>)[key] = TIER_MODULES.platinum[key]
                        }
                    }
                    return applyTierModuleDefaults(
                        applyTierEntitlements(base, tier, trialing ? 'free' : tier),
                        tier,
                    )
                }, 30)
            },
            [`features-${restaurantId}`],
            // 60 s is short enough that a migration or a super-admin tier change
            // propagates automatically without a manual cache bust, while still
            // keeping the hot path off the DB for every request.
            { tags: [`features-${restaurantId}`], revalidate: 60 }
        )
        const features = await fetcher().catch(() => null) as Settings['features_v2'] | null
        if (!features) return null

        const isIrd = !!features.irdSyncEnabled
        return {
            ...features,
            // IRD sync implies the accounting module regardless of plan — a
            // tenant filing to CBMS necessarily has books.
            financeEnabled: isIrd ? true : (features.financeEnabled ?? false),
            generateInvoiceEnabled: isIrd ? true : (features.generateInvoiceEnabled ?? true),
            printInvoiceEnabled: isIrd ? true : (features.printInvoiceEnabled ?? true),
            vatEnabled: isIrd ? features.vatEnabled : false,
        }
    } catch (e) {
        console.error('getRestaurantFeatures error:', e)
        return null
    }
}

/**
 * Fetch the restaurant's operational mode (derived from business_type).
 * Cached for 30 seconds — same rationale as getRestaurantFeatures.
 */
export async function getRestaurantMode(restaurantId: string): Promise<BusinessMode> {
    if (!restaurantId) return 'dine_in'
    try {
        const fetcher = unstable_cache(
            async () => {
                return fetchWithCache(`mode:${restaurantId}`, async () => {
                    const supabase = await createAdminClient()
                    const { data } = await supabase
                        .from('restaurants')
                        .select('business_type')
                        .eq('id', restaurantId)
                        .maybeSingle()
                    return getBusinessMode(data?.business_type)
                }, 86400)
            },
            [`mode-${restaurantId}`],
            { tags: [`mode-${restaurantId}`], revalidate: 3600 }
        )
        return (await fetcher().catch(() => 'dine_in')) || 'dine_in'
    } catch {
        return 'dine_in'
    }
}

/**
 * Fetch the restaurant/hotel's display name, for print tickets and the like.
 * Cached for a day — same rationale as getRestaurantMode.
 */
export async function getRestaurantName(restaurantId: string): Promise<string> {
    if (!restaurantId) return 'Restaurant'
    try {
        const fetcher = unstable_cache(
            async () => {
                return fetchWithCache(`restaurant-name:${restaurantId}`, async () => {
                    const supabase = await createAdminClient()
                    const { data } = await supabase
                        .from('restaurants')
                        .select('name')
                        .eq('id', restaurantId)
                        .maybeSingle()
                    return data?.name ?? 'Restaurant'
                }, 86400)
            },
            [`restaurant-name-${restaurantId}`],
            { tags: [`restaurant-name-${restaurantId}`], revalidate: 3600 }
        )
        return (await fetcher().catch(() => 'Restaurant')) || 'Restaurant'
    } catch {
        return 'Restaurant'
    }
}

/**
 * Fetch the customer-facing menu layout ('grid' | 'list') from settings.theme.
 * Cached for 30 seconds — changes rarely and rides a hot customer page path.
 */
export async function getMenuLayout(restaurantId: string): Promise<'grid' | 'list'> {
    if (!restaurantId) return 'grid'
    try {
        const fetcher = unstable_cache(
            async () => {
                return fetchWithCache(`menu-layout:${restaurantId}`, async () => {
                    const supabase = await createAdminClient()
                    const { data } = await supabase
                        .from('settings')
                        .select('theme')
                        .eq('restaurant_id', restaurantId)
                        .maybeSingle()
                    return (data?.theme as { menuLayout?: string } | null)?.menuLayout === 'list' ? 'list' : 'grid'
                }, 86400)
            },
            [`menu-layout-${restaurantId}`],
            { tags: [`menu-layout-${restaurantId}`], revalidate: 3600 }
        )
        return (await fetcher().catch(() => 'grid')) || 'grid'
    } catch {
        return 'grid'
    }
}

/**
 * Fetch restaurant with SaaS/Nepal fields for settings pages.
 */
export async function getRestaurantFull(restaurantId: string): Promise<Restaurant | null> {
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', restaurantId)
        .single()
    return data
}

/**
 * Check plan limit before creating a resource.
 */
export async function checkPlanLimit(restaurantId: string, resource: 'menu_items' | 'staff' | 'tables') {
    const supabase = await createAdminClient()
    const { data, error } = await supabase.rpc('check_plan_limit', {
        p_restaurant_id: restaurantId,
        p_resource: resource,
    })
    if (error) return { allowed: true, reason: 'Could not check limit' }
    return data as { allowed: boolean; current?: number; max?: number; tier?: string; reason: string }
}

/**
 * Update features_v2 flags (admin only).
 */
export async function updateFeaturesAction(restaurantId: string, features: Partial<Settings['features_v2']>) {
    // 'use server' makes this a public endpoint — it must enforce its own auth:
    // super admins can update any restaurant; managers only their own.
    const currentUser = await getCurrentUser()
    const isSuperAdmin = currentUser.role === 'super_admin'
    if (!isSuperAdmin && !(currentUser.role === 'manager' && currentUser.restaurantId === restaurantId)) {
        return { error: 'Unauthorized' }
    }
    const SUBSCRIPTION_FEATURES = [
        'financeEnabled', 'staffManagementEnabled', 'staffShiftsEnabled',
        'tableManagementEnabled', 'ingredientTrackingEnabled', 'loyaltyEnabled',
        'promosEnabled', 'dynamicPricingEnabled', 'takeoutEnabled',
        'generateInvoiceEnabled', 'printInvoiceEnabled', 'irdSyncEnabled',
        'kotEnabled', 'kdsEnabled'
    ]

    const supabase = await createAdminClient()

    // A manager may switch a module their plan includes on or off — it is their
    // restaurant and their subscription. What they may not do is grant
    // themselves a module the plan does not cover.
    //
    // This used to reject every subscription-level key outright with no regard
    // for the tier, so a manager on Enterprise was told "Unauthorized" for a
    // feature they had paid for and there was no in-app way to turn it on.
    if (!isSuperAdmin) {
        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('subscription_tier')
            .eq('id', restaurantId)
            .maybeSingle()
        const tier = restaurant?.subscription_tier

        const blocked = Object.keys(features).filter(key => {
            if (!SUBSCRIPTION_FEATURES.includes(key)) return false
            // Which hardware the kitchen runs on — a screen, a printer, or both
            // — is an operational choice about the tenant's own kitchen, not a
            // paid entitlement. Locking it to super admins meant a manager whose
            // KOT had never been switched on was told "your plan does not
            // include kotEnabled" and had no way to make tickets print.
            if (key === 'kotEnabled' || key === 'kdsEnabled') return false
            // Modules are plan-gated: allowed when the tier covers them.
            if ((MODULE_KEYS as readonly string[]).includes(key)) {
                return !tierIncludesModule(tier, key as ModuleKey)
            }
            // Paid capabilities are the manager's to switch on or off once the
            // plan covers them. This used to reject them outright, so a manager
            // on Enterprise was told "your enterprise plan does not include
            // loyaltyEnabled" for a module they had paid for.
            if ((TIER_ENTITLEMENTS as readonly string[]).includes(key)) {
                return !tierIncludesEntitlement(tier, key as TierEntitlement)
            }
            // Everything else on the subscription list stays super-admin only —
            // irdSync in particular carries tax-filing credentials.
            return true
        })

        if (blocked.length > 0) {
            return {
                error: `Your ${tier || 'current'} plan does not include: ${blocked.join(', ')}. Contact support to upgrade.`
            }
        }
    }

    // Merge with existing features
    const { data: existing } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single()

    const merged = { ...(existing?.features_v2 || {}), ...features }

    const { error } = await supabase
        .from('settings')
        .update({ features_v2: merged })
        .eq('restaurant_id', restaurantId)

    if (error) return { error: error.message }
    
    await invalidateCache(`features:${restaurantId}`)
    revalidateTag(`features-${restaurantId}`, 'max')
    revalidatePath('/waiter')
    revalidatePath('/admin/settings')
    
    return { success: true }
}
