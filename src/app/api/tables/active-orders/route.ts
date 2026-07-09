import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { getRoomContextForTable } from '@/lib/rooms'

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url)
        const tableSlug = searchParams.get('tableSlug')
        if (!tableSlug) {
            return NextResponse.json({ error: 'Missing tableSlug' }, { status: 400 })
        }

        const supabase = await createAdminClient()

        // 1. Resolve table
        const { data: tableData } = await supabase
            .from('tables')
            .select('id, room_id')
            .eq('qr_token', tableSlug)
            .single()

        if (!tableData) {
            return NextResponse.json({ orders: [] })
        }

        // Fetch active session
        const { data: sessionData } = await supabase
            .from('sessions')
            .select('id')
            .eq('table_id', tableData.id)
            .eq('status', 'active')
            .maybeSingle()

        const sessionUuid = sessionData?.id || null

        // 2. Resolve room context (for hotel bookings)
        const roomContext = await getRoomContextForTable(supabase, tableData.id)
        const bookingId = roomContext?.bookingId || null

        // 3. Query orders
        let query = supabase
            .from('orders')
            .select('id, status, placed_at')
            .neq('status', 'cancelled')

        if (bookingId) {
            // Hotel stay: fetch all orders bound to this booking
            query = query.eq('booking_id', bookingId)
        } else if (sessionUuid) {
            // Normal table: fetch all orders in active session
            query = query.eq('session_id', sessionUuid)
        } else {
            return NextResponse.json({ orders: [] })
        }

        const { data: orders, error } = await query.order('placed_at', { ascending: true })
        if (error) throw error

        return NextResponse.json({
            orders: (orders || []).map(o => ({
                id: o.id,
                status: o.status,
                placedAt: o.placed_at
            }))
        })
    } catch (e: any) {
        console.error('active-orders endpoint error:', e)
        return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 })
    }
}
