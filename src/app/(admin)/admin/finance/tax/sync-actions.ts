'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireFinanceManager() {
    return requireRole('super_admin', 'manager')
}

export async function getIrdSyncLogsAction() {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('ird_sync_logs')
        .select('*')
        .eq('restaurant_id', user.restaurantId)
        .order('created_at', { ascending: false })
        .limit(200)

    if (error) return { error: error.message }
    return { data }
}

export async function retryIrdSyncAction(logId: string) {
    let user
    try { user = await requireFinanceManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    // 1. Fetch the log row
    const { data: log, error: logErr } = await supabase
        .from('ird_sync_logs')
        .select('*')
        .eq('id', logId)
        .eq('restaurant_id', user.restaurantId)
        .single()

    if (logErr || !log) return { error: 'Sync log not found' }

    // 2. Fetch credentials
    const { data: rest } = await supabase
        .from('restaurants')
        .select('ird_api_url, ird_api_user, ird_api_password, vat_number, pan_number')
        .eq('id', user.restaurantId)
        .single()

    if (!rest?.ird_api_url || !rest?.ird_api_user || !rest?.ird_api_password) {
        return { error: 'Please configure your IRD API credentials in Settings first.' }
    }

    // 3. Fire the request
    const payload = {
        username: rest.ird_api_user,
        password: rest.ird_api_password,
        seller_pan: rest.vat_number || rest.pan_number || '',
        buyer_pan: log.buyer_pan || '',
        buyer_name: 'Walk-in Guest',
        invoice_number: log.invoice_number,
        invoice_date: new Date(log.created_at).toISOString().split('T')[0],
        total_sales: Number(log.total_amount),
        taxable_amount: Number(log.taxable_amount),
        vat_amount: Number(log.vat_amount),
        excise_amount: 0.00,
        discount_amount: 0.00,
        service_charge: 0.00,
        is_realtime: true
    }

    try {
        const response = await fetch(rest.ird_api_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(6000)
        })

        const textResponse = await response.text()
        const isSuccess = response.ok && (textResponse.includes('success') || response.status === 200)

        await supabase
            .from('ird_sync_logs')
            .update({
                sync_status: isSuccess ? 'synced' : 'failed',
                sync_response: `Status: ${response.status} - ${textResponse}`,
                synced_at: new Date().toISOString()
            })
            .eq('id', logId)

        revalidatePath('/admin/finance/tax')
        return { success: isSuccess, response: textResponse }

    } catch (err: any) {
        await supabase
            .from('ird_sync_logs')
            .update({
                sync_status: 'failed',
                sync_response: `Retry Error: ${err.message || 'Connection Timeout'}`
            })
            .eq('id', logId)
        return { error: err.message || 'Connection Timeout' }
    }
}
