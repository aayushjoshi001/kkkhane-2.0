'use server'

import { createAdminClient } from '@/lib/supabase/server'
import type { PromoCode, LoyaltyMember, LoyaltyConfig } from '@/types/database'

// ============================================================
// PROMO CODE VALIDATION
// ============================================================
export async function validatePromoCode(
    code: string,
    restaurantId: string,
    subtotal: number
): Promise<{
    valid: boolean
    promo?: PromoCode
    discountPreview?: number
    error?: string
}> {
    const supabase = await createAdminClient()

    const { data: promo, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('code', code.toUpperCase().trim())
        .eq('is_active', true)
        .single()

    if (error || !promo) {
        return { valid: false, error: 'Invalid promo code.' }
    }

    // Check validity period
    if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
        return { valid: false, error: 'This promo code has expired.' }
    }

    // Check usage limits
    if (promo.max_uses && promo.current_uses >= promo.max_uses) {
        return { valid: false, error: 'This promo code has reached its usage limit.' }
    }

    // Check minimum order amount
    if (subtotal < promo.min_order_amount) {
        return {
            valid: false,
            error: `Minimum order of Rs. ${promo.min_order_amount.toFixed(2)} required.`,
        }
    }

    // Calculate discount preview
    let discountPreview = 0
    switch (promo.promo_type) {
        case 'percentage_off':
            discountPreview = Math.round(subtotal * promo.value / 100 * 100) / 100
            if (promo.max_discount_amount) {
                discountPreview = Math.min(discountPreview, promo.max_discount_amount)
            }
            break
        case 'amount_off':
            discountPreview = Math.min(promo.value, subtotal)
            break
        case 'free_item':
        case 'bogo':
            discountPreview = promo.value // approximate
            break
    }

    return {
        valid: true,
        promo: promo as PromoCode,
        discountPreview,
    }
}

// ============================================================
// LOYALTY: LOOKUP OR CREATE MEMBER
// ============================================================
export async function lookupLoyaltyMember(
    restaurantId: string,
    phone: string
): Promise<{ member?: LoyaltyMember; error?: string }> {
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('loyalty_members')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('phone', phone.trim())
        .single()

    if (error || !data) {
        return { error: 'Member not found. Would you like to sign up?' }
    }

    return { member: data as LoyaltyMember }
}

export async function signUpLoyalty(
    restaurantId: string,
    phone: string,
    displayName?: string,
    email?: string
): Promise<{ member?: LoyaltyMember; bonusPoints?: number; error?: string }> {
    const supabase = await createAdminClient()

    // Check if already exists
    const { data: existing } = await supabase
        .from('loyalty_members')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('phone', phone.trim())
        .single()

    if (existing) {
        return { error: 'This phone number is already registered.' }
    }

    // Get signup bonus from config
    const { data: config } = await supabase
        .from('loyalty_config')
        .select('signup_bonus_points')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .single()

    const bonusPoints = config?.signup_bonus_points || 0

    const { data: member, error } = await supabase
        .from('loyalty_members')
        .insert({
            restaurant_id: restaurantId,
            phone: phone.trim(),
            display_name: displayName || null,
            email: email || null,
            points_balance: bonusPoints,
            lifetime_points: bonusPoints,
        })
        .select()
        .single()

    if (error || !member) {
        return { error: 'Failed to create account. Please try again.' }
    }

    // Log the bonus
    if (bonusPoints > 0) {
        await supabase.from('loyalty_transactions').insert({
            member_id: member.id,
            type: 'bonus',
            points: bonusPoints,
            description: 'Sign-up bonus',
        })
    }

    return { member: member as LoyaltyMember, bonusPoints }
}

export async function getLoyaltyConfig(
    restaurantId: string
): Promise<LoyaltyConfig | null> {
    const supabase = await createAdminClient()

    const { data } = await supabase
        .from('loyalty_config')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .single()

    return data as LoyaltyConfig | null
}

export async function redeemLoyaltyPoints(
    memberId: string,
    restaurantId: string
): Promise<{ discount: number; error?: string }> {
    const supabase = await createAdminClient()

    // Get config
    const config = await getLoyaltyConfig(restaurantId)
    if (!config) return { discount: 0, error: 'Loyalty program not active.' }

    // Get member
    const { data: member } = await supabase
        .from('loyalty_members')
        .select('points_balance')
        .eq('id', memberId)
        .single()

    if (!member || member.points_balance < config.redemption_threshold) {
        return {
            discount: 0,
            error: `Need at least ${config.redemption_threshold} points to redeem. You have ${member?.points_balance || 0}.`,
        }
    }

    // Deduct points
    await supabase
        .from('loyalty_members')
        .update({
            points_balance: member.points_balance - config.redemption_threshold,
            updated_at: new Date().toISOString(),
        })
        .eq('id', memberId)

    // Log the transaction
    await supabase.from('loyalty_transactions').insert({
        member_id: memberId,
        type: 'redeem',
        points: -config.redemption_threshold,
        description: `Redeemed ${config.redemption_threshold} points for Rs. ${config.redemption_value.toFixed(2)} discount`,
    })

    // Post the discount as a cost so it shows up in Income & Expenses / the
    // Finance Report — otherwise the real price of running the loyalty
    // program is invisible outside loyalty_transactions. No cash actually
    // left the business, so this intentionally never touches the Day Book.
    if (config.redemption_value > 0) {
        void postLoyaltyRedemptionExpense(supabase, restaurantId, config.redemption_threshold, config.redemption_value)
    }

    return { discount: config.redemption_value }
}

async function postLoyaltyRedemptionExpense(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    restaurantId: string,
    pointsRedeemed: number,
    amount: number
) {
    let categoryId: string | undefined
    const { data: existingCategory } = await supabase
        .from('expense_categories')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('name', 'Loyalty Rewards')
        .maybeSingle()

    categoryId = existingCategory?.id
    if (!categoryId) {
        const { data: newCategory } = await supabase
            .from('expense_categories')
            .insert({ restaurant_id: restaurantId, name: 'Loyalty Rewards' })
            .select('id')
            .single()
        categoryId = newCategory?.id
    }
    if (!categoryId) return

    const { error } = await supabase.from('expenses').insert({
        restaurant_id: restaurantId,
        category_id: categoryId,
        amount,
        description: `Loyalty redemption: ${pointsRedeemed} points`,
        status: 'paid',
    })

    if (error) console.error('Failed to post loyalty redemption expense:', error)
}
