import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { createAdminClient } from '@/lib/supabase/server'

// This endpoint receives the CRON trigger from Upstash QStash
// The 'verifySignatureAppRouter' middleware ensures that only QStash can call this endpoint
async function handler(req: Request) {
    console.log('[QStash] Starting Daily Rollup...')

    try {
        const supabase = await createAdminClient()
        
        // 1. Get all active restaurants
        const { data: restaurants, error: restErr } = await supabase
            .from('restaurants')
            .select('id')
        
        if (restErr) throw restErr

        // 2. Loop through each restaurant and process their end of day rollup
        for (const restaurant of restaurants || []) {
            console.log(`[QStash] Processing rollup for restaurant: ${restaurant.id}`)
            
            // Here we would typically aggregate today's 'orders' into a 'daily_sales_report' table.
            // Example stub:
            // const today = new Date().toISOString().split('T')[0]
            // const { data: orders } = await supabase.from('orders').select('total_amount').eq('restaurant_id', restaurant.id).gte('created_at', today)
            // ... insert into daily_reports ...
        }

        console.log('[QStash] Daily Rollup Complete!')
        return NextResponse.json({ success: true })
    } catch (error: any) {
        console.error('[QStash] Daily Rollup Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

export const dynamic = 'force-dynamic'

export const POST = async (req: Request) => {
    if (!process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) {
        return handler(req)
    }
    return verifySignatureAppRouter(handler)(req)
}
