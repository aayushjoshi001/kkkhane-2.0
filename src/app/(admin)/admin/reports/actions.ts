'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { generateEodReport } from '@/lib/reports'
import { getFinanceDaySummary } from '@/lib/financeReports'

export type ReconciliationRow = {
    order_id: string
    order_total: number
    payment_status: string
    verified_amount: number | null
    verification_method: string | null
    discrepancy: number
    status: 'ok' | 'unverified' | 'mismatch'
}

/**
 * Compares paid orders against payment_verifications for a given date range.
 * Returns rows with discrepancies so managers can investigate.
 */
export async function runPaymentReconciliation(
    restaurantId: string,
    fromDate: string,
    toDate: string
): Promise<{ error?: string; rows?: ReconciliationRow[]; summary?: { total: number; ok: number; unverified: number; mismatch: number; discrepancyTotal: number } }> {
    const currentUser = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    // Fetch paid orders in range
    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, total_amount, payment_status, paid_at')
        .eq('restaurant_id', restaurantId)
        .eq('payment_status', 'paid')
        .gte('paid_at', fromDate)
        .lte('paid_at', toDate + 'T23:59:59Z')
        .order('paid_at', { ascending: true })

    if (ordersError) return { error: ordersError.message }

    // Fetch verifications in range
    const { data: verifications } = await supabase
        .from('payment_verifications')
        .select('order_id, amount, payment_method')
        .eq('restaurant_id', restaurantId)
        .eq('staff_verified', true)
        .not('order_id', 'is', null)

    const verMap = new Map<string, { amount: number; payment_method: string }>()
    for (const v of verifications || []) {
        if (v.order_id) verMap.set(v.order_id, { amount: v.amount, payment_method: v.payment_method })
    }

    const rows: ReconciliationRow[] = []
    let ok = 0, unverified = 0, mismatch = 0, discrepancyTotal = 0

    for (const order of orders || []) {
        const ver = verMap.get(order.id)
        const orderTotal = order.total_amount ?? 0
        const verifiedAmount = ver?.amount ?? null
        const discrepancy = ver ? Math.abs(orderTotal - ver.amount) : orderTotal

        let status: ReconciliationRow['status']
        if (!ver) {
            status = 'unverified'
            unverified++
            discrepancyTotal += discrepancy
        } else if (discrepancy > 0.01) {
            status = 'mismatch'
            mismatch++
            discrepancyTotal += discrepancy
        } else {
            status = 'ok'
            ok++
        }

        rows.push({
            order_id: order.id,
            order_total: orderTotal,
            payment_status: order.payment_status,
            verified_amount: verifiedAmount,
            verification_method: ver?.payment_method ?? null,
            discrepancy,
            status,
        })
    }

    void logAudit({
        restaurantId,
        userId: currentUser.id,
        action: 'report_generated',
        entityType: 'reconciliation',
        newValue: { from: fromDate, to: toDate, total: rows.length, mismatch, unverified },
    })

    return {
        rows,
        summary: { total: rows.length, ok, unverified, mismatch, discrepancyTotal },
    }
}

export async function generateEodReportAction(restaurantId: string, reportDate: string) {
    try {
        const currentUser = await requireRole('manager', 'super_admin')
        if (restaurantId !== currentUser.restaurantId) {
            return { error: 'Unauthorized' }
        }
        const data = await generateEodReport(restaurantId, reportDate)
        return { data }
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to generate report' }
    }
}

export async function getFinanceDaySummaryAction(restaurantId: string, date: string) {
    try {
        const currentUser = await requireRole('manager', 'super_admin')
        if (restaurantId !== currentUser.restaurantId) {
            return { error: 'Unauthorized' }
        }
        const supabase = await createAdminClient()
        const data = await getFinanceDaySummary(supabase, restaurantId, date)
        return { data }
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to load finance summary' }
    }
}

export async function getEodReportsAction(restaurantId: string, limit = 30) {
    try {
        const currentUser = await requireRole('manager', 'super_admin')
        if (restaurantId !== currentUser.restaurantId) {
            return { error: 'Unauthorized', data: [] }
        }
        const supabase = await createAdminClient()
        const { data } = await supabase
            .from('eod_reports')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('report_date', { ascending: false })
            .limit(limit)
        return { data: data || [] }
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to get reports', data: [] }
    }
}

export async function getEodReportAction(reportId: string) {
    try {
        const currentUser = await requireRole('manager', 'super_admin')
        const supabase = await createAdminClient()
        const { data } = await supabase
            .from('eod_reports')
            .select('*')
            .eq('id', reportId)
            .single()

        if (data && data.restaurant_id !== currentUser.restaurantId) {
            return { error: 'Unauthorized' }
        }
        return { data }
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to get report' }
    }
}
