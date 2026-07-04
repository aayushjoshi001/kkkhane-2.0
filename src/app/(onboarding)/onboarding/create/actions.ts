'use server'

import { getOptionalUser } from '@/lib/auth'
import { provisionRestaurant } from '@/lib/provisioning'
import { createAdminClient } from '@/lib/supabase/server'

function normalizeSlug(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export async function createOnboardingRestaurant(formData: FormData) {
    const user = await getOptionalUser()
    if (!user) {
        return { error: 'Not authenticated' }
    }

    const restaurantName = formData.get('restaurantName') as string
    if (!restaurantName || restaurantName.trim() === '') {
        return { error: 'Restaurant name is required', field: 'restaurantName' }
    }

    const slug = formData.get('restaurantSlug') as string
    if (!slug || slug.trim() === '') {
        return { error: 'Restaurant URL Slug is required', field: 'restaurantSlug' }
    }

    const contactPhone = (formData.get('contactPhone') as string) || null
    const address = (formData.get('address') as string) || null
    const businessType = (formData.get('type') as string) || null
    
    // Tax Info
    const panNumber = (formData.get('panNumber') as string) || null
    const vatRegistered = formData.get('vatRegistered') === 'true'
    
    // Slogan
    const slogan = (formData.get('slogan') as string) || null

    const latitudeRaw = formData.get('latitude') as string
    const longitudeRaw = formData.get('longitude') as string
    const latitude = latitudeRaw ? parseFloat(latitudeRaw) : null
    const longitude = longitudeRaw ? parseFloat(longitudeRaw) : null

    const adminSupabase = await createAdminClient()
    const { data: userRow } = await adminSupabase
        .from('users').select('full_name').eq('id', user.id).maybeSingle()

    const result = await provisionRestaurant({
        ownerId: user.id,
        ownerEmail: user.email,
        ownerName: userRow?.full_name || user.email || 'Owner',
        name: restaurantName.trim(),
        slug: normalizeSlug(slug),
        contactPhone,
        address,
        businessType,
        panNumber,
        vatRegistered,
        slogan,
        latitude,
        longitude,
        tier: 'free',
    })

    if (result.error) {
        return { error: result.error, field: result.field }
    }

    return { success: true }
}
