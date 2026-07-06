import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { invalidateCache } from '@/lib/redis'

// Columns the manager is allowed to write. Anything else in the request body
// (id, created_at, computed fields, …) is ignored to prevent both
// "column not found" errors and mass-assignment.
const WRITABLE_COLUMNS = [
    'template',
    'hero_title',
    'hero_subtitle',
    'hero_image_url',
    'hero_video_url',
    'hero_cta_text',
    'theme_primary',
    'theme_secondary',
    'theme_accent',
    'logo_url',
    'about',
    'features',
    'cta',
    'gallery',
    'social',
    'contact',
    'footer',
] as const

function pickWritable(body: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const key of WRITABLE_COLUMNS) {
        if (key in body) out[key] = body[key]
    }
    return out
}

export async function POST(req: NextRequest) {
    try {
        const user = await getCurrentUser()
        const supabase = await createAdminClient()

        const body = await req.json()
        const { restaurant_id } = body

        if (!restaurant_id) {
            return NextResponse.json({ error: 'restaurant_id is required' }, { status: 400 })
        }

        // Verify user has access to this restaurant
        const { data: userData } = await supabase
            .from('users')
            .select('restaurant_id')
            .eq('id', user.id)
            .single()

        if (userData?.restaurant_id !== restaurant_id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
        }

        const configData = pickWritable(body)

        // Check if homepage config exists
        const { data: existing } = await supabase
            .from('homepage_configs')
            .select('id')
            .eq('restaurant_id', restaurant_id)
            .single()

        if (existing) {
            const { data: updatedConfig, error } = await supabase
                .from('homepage_configs')
                .update({
                    ...configData,
                    updated_at: new Date().toISOString(),
                })
                .eq('restaurant_id', restaurant_id)
                .select()
                .single()

            if (error) {
                console.error('Homepage update error:', error)
                return NextResponse.json({ error: error.message }, { status: 400 })
            }

            await invalidateCache(`homepage-config:${restaurant_id}`)
            return NextResponse.json({ success: true, config: updatedConfig })
        } else {
            const { data: newConfig, error } = await supabase
                .from('homepage_configs')
                .insert({
                    restaurant_id,
                    ...configData,
                })
                .select()
                .single()

            if (error) {
                console.error('Homepage create error:', error)
                return NextResponse.json({ error: error.message }, { status: 400 })
            }

            await invalidateCache(`homepage-config:${restaurant_id}`)
            return NextResponse.json({ success: true, config: newConfig }, { status: 201 })
        }
    } catch (error) {
        console.error('Homepage endpoint error:', error)
        const message = error instanceof Error ? error.message : 'Internal server error'
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
