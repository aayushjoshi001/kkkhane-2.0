import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { createAdminClient } from '@/lib/supabase/server'
// import { sendOrderReceiptEmail } from '@/lib/email'

async function handler(req: Request) {
    console.log('[QStash] Starting Background Order Processing...')
    try {
        const body = await req.json()
        const { orderId, restaurantId } = body

        if (!orderId || !restaurantId) {
            return NextResponse.json({ error: 'Missing orderId or restaurantId' }, { status: 400 })
        }

        const supabase = await createAdminClient()
        
        // 1. Fetch the full order details
        const { data: order, error } = await supabase
            .from('orders')
            .select('*, order_items(*, menu_items(name))')
            .eq('id', orderId)
            .single()

        if (error || !order) {
            throw new Error(`Order ${orderId} not found`)
        }

        console.log(`[QStash] Successfully loaded background context for Order ${orderId}`)

        // 2. Perform heavy background tasks here!
        // - Generate PDF Receipt
        // - Send Email via Resend
        // - Trigger webhooks to third-party integrations (e.g. accounting software)
        // - Advanced AI Loyalty Analysis

        // Example:
        // if (order.customer_email) {
        //     await sendOrderReceiptEmail(order)
        // }

        console.log('[QStash] Background Order Processing Complete!')
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[QStash] Background Order Processing Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export const POST = verifySignatureAppRouter(handler)
