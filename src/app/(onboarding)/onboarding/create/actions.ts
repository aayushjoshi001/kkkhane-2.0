'use server'

import { getOptionalUser } from '@/lib/auth'
import { provisionRestaurant } from '@/lib/provisioning'
import { createAdminClient } from '@/lib/supabase/server'
import { OnboardingRestaurantSchema } from '@/lib/validation'

function normalizeSlug(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function fieldErrorsFromZod(issues: { path: (string | number)[]; message: string }[]) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return fieldErrors
}

export async function createOnboardingRestaurant(formData: FormData) {
    const user = await getOptionalUser()
    if (!user) {
        return { error: 'Not authenticated' }
    }

    const raw = Object.fromEntries(formData.entries()) as Record<string, string>

    const parsed = OnboardingRestaurantSchema.safeParse({
        ...raw,
        vatRegistered: raw.vatRegistered === 'true',
        latitude: raw.latitude ? parseFloat(raw.latitude) : undefined,
        longitude: raw.longitude ? parseFloat(raw.longitude) : undefined,
    })

    if (!parsed.success) {
        return {
            error: 'Please fix the highlighted fields.',
            fieldErrors: fieldErrorsFromZod(parsed.error.issues),
        }
    }

    const data = parsed.data

    const adminSupabase = await createAdminClient()
    const { data: userRow } = await adminSupabase
        .from('users').select('full_name').eq('id', user.id).maybeSingle()

    const result = await provisionRestaurant({
        ownerId: user.id,
        ownerEmail: user.email,
        ownerName: userRow?.full_name || user.email || 'Owner',
        name: data.restaurantName.trim(),
        slug: normalizeSlug(data.restaurantSlug),
        contactPhone: data.contactPhone || null,
        address: data.address || null,
        businessType: data.businessType || null,
        panNumber: data.panNumber || null,
        vatRegistered: data.vatRegistered,
        vatNumber: data.vatNumber || null,
        slogan: data.slogan || null,
        contactEmail: data.restaurantEmail || null,
        telephone: data.telephone || null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        tier: 'free',
    })

    if (result.error) {
        return {
            error: result.error,
            fieldErrors: { [result.field ?? 'restaurantName']: result.error },
        }
    }

    return { success: true, restaurantId: result.restaurantId }
}

export async function setOnboardingLogo(restaurantId: string, logoUrl: string) {
    const user = await getOptionalUser()
    if (!user || user.restaurantId !== restaurantId) {
        return { error: 'Not authorized' }
    }

    const adminSupabase = await createAdminClient()
    const { error } = await adminSupabase
        .from('restaurants')
        .update({ logo_url: logoUrl })
        .eq('id', restaurantId)

    return error ? { error: error.message } : { success: true }
}

export async function checkSlugAvailability(slug: string) {
    const normalized = normalizeSlug(slug)
    if (!normalized) return { available: false }

    const adminSupabase = await createAdminClient()
    const { data } = await adminSupabase
        .from('restaurants')
        .select('id')
        .eq('slug', normalized)
        .maybeSingle()

    return { available: !data }
}
