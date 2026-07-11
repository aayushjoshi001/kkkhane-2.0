import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'

// Active QR codes registered by the restaurant (Settings → QR Payment), used
// wherever staff record a QR payment so they can indicate which one the
// customer scanned instead of the amount landing in an arbitrary bank account.
export async function GET() {
    try {
        const currentUser = await getCurrentUser()
        if (!currentUser || !currentUser.restaurantId) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const supabase = await createAdminClient()
        const { data, error } = await supabase
            .from('payment_qr_codes')
            .select('id, label')
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('is_active', true)
            .order('created_at', { ascending: true })

        if (error) throw error
        return NextResponse.json({ success: true, data: data ?? [] })
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
