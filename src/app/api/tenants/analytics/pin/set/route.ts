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

        if (!pin || typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
            return NextResponse.json({ error: 'PIN must be exactly 6 digits' }, { status: 400 })
        }

        // Hash PIN using bcryptjs
        const pinHash = await bcrypt.hash(pin, 10)

        const supabase = await createAdminClient()
        const { error } = await supabase
            .from('restaurants')
            .update({
                analytics_pin_hash: pinHash,
                analytics_shared: true
            })
            .eq('id', currentUser.restaurantId)

        if (error) {
            console.error('Failed to set PIN:', error)
            return NextResponse.json({ error: 'Database update failed' }, { status: 500 })
        }

        return NextResponse.json({ success: true, message: 'Shared analytics PIN configured successfully' })
    } catch (e: any) {
        console.error('Set PIN error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
