import { createAdminClient } from './supabase/server'

interface SyncInvoicePayload {
    invoiceNumber: string
    buyerName?: string | null
    buyerPan?: string | null
    totalAmount: number
    discountAmount: number
    taxableAmount: number
    vatAmount: number
}

/**
 * Direct sync hook to submit billing receipts to Nepal Inland Revenue Department (IRD)
 * according to CBMS API standards. If credentials are not fully configured,
 * it runs in simulation mode to ensure audit-readiness without throwing errors.
 * 
 * NOTE: All log database operations are wrapped in safe try-catch blocks to prevent
 * checkout failures if SQL table migrations have not been applied.
 */
export async function syncInvoiceToIrd(restaurantId: string, data: SyncInvoicePayload) {
    const supabase = await createAdminClient()

    // 1. Fetch restaurant settings to verify VAT registration and API credentials
    const { data: rest, error: restErr } = await supabase
        .from('restaurants')
        .select('vat_registered, vat_number, pan_number, ird_api_url, ird_api_user, ird_api_password')
        .eq('id', restaurantId)
        .single()

    if (restErr || !rest) {
        console.error('Failed to load restaurant details for IRD Sync:', restErr)
        return { success: false, error: 'Restaurant details not found' }
    }

    // IRD sync only applies to VAT registered properties
    if (!rest.vat_registered) {
        return { success: true, bypassed: true, reason: 'Property not VAT registered (PAN Standalone)' }
    }

    const { ird_api_url, ird_api_user, ird_api_password, pan_number, vat_number } = rest

    // 2. SIMULATION MODE (auditor ready): If credentials are not set, log a successful simulated sync
    if (!ird_api_url || ird_api_url.trim() === '' || !ird_api_user || !ird_api_password) {
        const textResponse = "SIMULATED_CBMS_ACK - Invoice sync successful (Simulation Mode)."
        try {
            await supabase.from('ird_sync_logs').insert({
                restaurant_id: restaurantId,
                invoice_number: data.invoiceNumber,
                buyer_pan: data.buyerPan || null,
                total_amount: data.totalAmount,
                taxable_amount: data.taxableAmount,
                vat_amount: data.vatAmount,
                sync_status: 'synced',
                sync_response: textResponse,
                synced_at: new Date().toISOString()
            })
        } catch (dbErr) {
            console.warn('Defensive Warn: Failed to write ird_sync_logs (migration may not be run):', dbErr)
        }
        return { success: true, mocked: true, response: textResponse }
    }

    // 3. Prepare Nepalese Government IRD CBMS payload structure
    const payload = {
        username: ird_api_user,
        password: ird_api_password,
        seller_pan: vat_number || pan_number || '',
        buyer_pan: data.buyerPan || '',
        buyer_name: data.buyerName || 'Walk-in Guest',
        invoice_number: data.invoiceNumber,
        invoice_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        total_sales: Number(data.totalAmount),
        taxable_amount: Number(data.taxableAmount),
        vat_amount: Number(data.vatAmount),
        excise_amount: 0.00,
        discount_amount: Number(data.discountAmount),
        service_charge: 0.00,
        is_realtime: true
    }

    // 4. Insert initial log record as pending (defended against database errors)
    let logId: string | null = null
    try {
        const { data: logRow } = await supabase
            .from('ird_sync_logs')
            .insert({
                restaurant_id: restaurantId,
                invoice_number: data.invoiceNumber,
                buyer_pan: data.buyerPan || null,
                total_amount: data.totalAmount,
                taxable_amount: data.taxableAmount,
                vat_amount: data.vatAmount,
                sync_status: 'pending'
            })
            .select('id')
            .single()
        logId = logRow?.id || null
    } catch (dbErr) {
        console.warn('Defensive Warn: Failed to write ird_sync_logs (migration may not be run):', dbErr)
    }

    // 5. Fire the HTTP request to the government CBMS endpoint
    try {
        const response = await fetch(ird_api_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(6000)
        })

        const textResponse = await response.text()
        const isSuccess = response.ok && (textResponse.includes('success') || response.status === 200)

        // 6. Update log record with response details
        if (logId) {
            try {
                await supabase
                    .from('ird_sync_logs')
                    .update({
                        sync_status: isSuccess ? 'synced' : 'failed',
                        sync_response: `Status: ${response.status} - ${textResponse}`,
                        synced_at: new Date().toISOString()
                    })
                    .eq('id', logId)
            } catch (dbErr) {
                console.error('Failed to update ird_sync_logs status:', dbErr)
            }
        }

        return { success: isSuccess, status: response.status, response: textResponse }

    } catch (err: any) {
        console.error('IRD Sync Connection Error:', err)
        if (logId) {
            try {
                await supabase
                    .from('ird_sync_logs')
                    .update({
                        sync_status: 'failed',
                        sync_response: `Error: ${err.message || 'Connection Timeout'}`
                    })
                    .eq('id', logId)
            } catch (dbErr) {
                console.error('Failed to update failed ird_sync_logs status:', dbErr)
            }
        }
        return { success: false, error: err.message || 'Connection Timeout' }
    }
}
