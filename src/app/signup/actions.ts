'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { validateInput, PublicSignupSchema } from '@/lib/validation'
import { checkRateLimit } from '@/lib/ratelimit'
import { sendOnboardingEmail } from '@/lib/email'
import { provisionRestaurant } from '@/lib/provisioning'
import { type Tier } from '@/lib/tiers'

function normalizeSlug(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export interface SignupResult {
    success?: boolean
    error?: string
    field?: string
}

export async function signupRestaurant(input: unknown): Promise<SignupResult> {
    // Rate limit: 3 signups per hour per IP
    const rateLimitError = await checkRateLimit('SIGNUP', 3, 3600)
    if (rateLimitError) return { error: rateLimitError }

    const validation = validateInput(PublicSignupSchema, input)
    if (!validation.success) {
        return { error: `Invalid input: ${validation.error}` }
    }

    const data = validation.data!
    const restaurantName  = data.restaurantName.trim()
    const ownerFullName   = data.ownerFullName.trim()
    const ownerEmail      = data.ownerEmail.trim().toLowerCase()
    const ownerPassword   = data.ownerPassword.trim()
    const restaurantSlug  = normalizeSlug(data.restaurantSlug || data.restaurantName)
    const contactPhone    = data.contactPhone?.trim() || null
    const address         = data.address?.trim() || null
    const tier            = (data.subscriptionTier || 'free') as Tier
    const panNumber       = data.panNumber?.trim() || null
    const vatRegistered   = data.vatRegistered ?? false
    const vatNumber       = data.vatNumber?.trim() || null
    const slogan          = data.slogan?.trim() || null
    const restaurantEmail = data.restaurantEmail?.trim().toLowerCase() || null
    const telephone       = data.telephone?.trim() || null
    const latitude        = data.latitude ?? null
    const longitude       = data.longitude ?? null

    const supabase = await createAdminClient()

    // Check slug uniqueness early for a friendly error (provisionRestaurant re-checks)
    const { data: existingSlug } = await supabase
        .from('restaurants').select('id').eq('slug', restaurantSlug).maybeSingle()
    if (existingSlug) return { error: 'That restaurant URL slug is already taken. Please choose another.', field: 'restaurantSlug' }

    let authUserId: string | null = null

    try {
        // 1. Create auth user — returns specific error if email already exists
        const { data: createdUser, error: authError } = await supabase.auth.admin.createUser({
            email: ownerEmail,
            password: ownerPassword,
            email_confirm: true,
            user_metadata: { full_name: ownerFullName },
        })
        if (authError || !createdUser.user) {
            const isEmailTaken = authError?.message?.toLowerCase().includes('already registered') ||
                authError?.message?.toLowerCase().includes('already been registered')
            return {
                error: isEmailTaken ? 'That email is already registered. Try logging in instead.' : (authError?.message || 'Failed to create account. Please try again.'),
                field: isEmailTaken ? 'ownerEmail' : undefined,
            }
        }
        authUserId = createdUser.user.id

        // 2. Provision the restaurant (restaurant + user row + settings + starter menu + tables).
        // No wait needed: the auth trigger creates the public.users row synchronously
        // in the same transaction as auth.users, and provisionRestaurant upserts by id.
        const result = await provisionRestaurant({
            ownerId: authUserId,
            ownerEmail,
            ownerName: ownerFullName,
            name: restaurantName,
            slug: restaurantSlug,
            contactPhone,
            address,
            tier,
            contactEmail: restaurantEmail,
            slogan,
            telephone,
            panNumber,
            vatRegistered,
            vatNumber,
            latitude,
            longitude,
        })

        if (result.error || !result.restaurantId) {
            throw new Error(result.error || 'Failed to create restaurant.')
        }

        // 3. Send welcome email (best-effort — don't fail signup if email fails)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yourapp.com'
        sendOnboardingEmail(ownerEmail, restaurantName, ownerFullName, `${appUrl}/admin/dashboard`).catch(() => {})

        return { success: true }

    } catch (error) {
        // Rollback: provisionRestaurant already cleans up the restaurant on failure;
        // here we additionally delete the orphaned auth user.
        if (authUserId) await supabase.auth.admin.deleteUser(authUserId)
        return { error: error instanceof Error ? error.message : 'Signup failed. Please try again.' }
    }
}
