import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import bcrypt from 'bcryptjs'

export async function POST(req: Request) {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json().catch(() => ({}))
        const { pin } = body

        if (!pin || typeof pin !== 'string') {
            return NextResponse.json({ error: 'Missing security PIN' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Resolve partner property
        const { data: myRest } = await supabase
            .from('restaurants')
            .select('linked_restaurant_id, linked_hotel_id')
            .eq('id', currentUser.restaurantId)
            .single()

        const partnerId = myRest?.linked_restaurant_id || myRest?.linked_hotel_id
        if (!partnerId) {
            return NextResponse.json({ error: 'No linked partner property found' }, { status: 400 })
        }

        // 2. Fetch partner settings
        const { data: partnerRest } = await supabase
            .from('restaurants')
            .select('analytics_pin_hash, analytics_shared')
            .eq('id', partnerId)
            .single()

        if (!partnerRest || !partnerRest.analytics_shared || !partnerRest.analytics_pin_hash) {
            return NextResponse.json({ error: 'Partner property has not shared financial analytics' }, { status: 400 })
        }

        // 3. Verify security PIN
        const match = await bcrypt.compare(pin, partnerRest.analytics_pin_hash)

        if (!match) {
            // Log access failure in audit logs
            await supabase.from('cross_tenant_audit_logs').insert({
                actor_tenant_id: currentUser.restaurantId,
                target_tenant_id: partnerId,
                action: 'analytics_access_failed',
                details: 'Unauthorized PIN verification attempt'
            })

            return NextResponse.json({ error: 'Invalid security PIN' }, { status: 401 })
        }

        // 4. Generate 10-minute session token
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
        const { data: tokenData, error: tokenErr } = await supabase
            .from('analytics_session_tokens')
            .insert({
                tenant_id: partnerId,
                viewer_tenant_id: currentUser.restaurantId,
                expires_at: expiresAt
            })
            .select('id')
            .single()

        if (tokenErr) {
            console.error('Failed to create session token:', tokenErr)
            return NextResponse.json({ error: 'Database session error' }, { status: 500 })
        }

        // 5. Write immutable PIN access audit log
        await supabase.from('cross_tenant_audit_logs').insert({
            actor_tenant_id: currentUser.restaurantId,
            target_tenant_id: partnerId,
            action: 'analytics_accessed',
            details: 'Financial analytics accessed successfully via PIN'
        })

        return NextResponse.json({
            success: true,
            expiresAt,
            token: tokenData.id
        })
    } catch (e: any) {
        console.error('Verify PIN error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
