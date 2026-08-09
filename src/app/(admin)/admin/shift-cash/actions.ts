'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { computeShiftExpectedCash } from '@/lib/shiftCash'
import { round2 } from '@/lib/utils'
import { logAudit } from '@/lib/audit'
import { getNstDateString, addDays } from '@/lib/timezone'

export interface ReconcileShiftCashResult {
    error?: string
    success?: boolean
    expected?: number
    counted?: number
    variance?: number
}

/**
 * Manager counts the cash+QR a staff member handed over for one shift and
 * records it against that shift. A shortfall (counted < expected) becomes a
 * `deduction` on the staff member's ledger.
 */
export async function reconcileShiftCashAction(
    shiftId: string,
    countedAmount: number,
    note?: string,
    countedCashAmount?: number,
    countedQrAmount?: number
): Promise<ReconcileShiftCashResult> {
    const currentUser = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    if (!Number.isFinite(countedAmount) || countedAmount < 0) {
        return { error: 'Enter a valid counted amount' }
    }

    let shift: {
        id: string
        user_id: string
        restaurant_id: string
        clock_in: string
        clock_out: string | null
        deduction_ledger_id: string | null
    } | null = null

    if (shiftId.startsWith('unmapped-')) {
        const parts = shiftId.replace(/^unmapped-/, '').split('-')
        const targetUserId = parts[0]
        const todayDate = getNstDateString()
        const rangeStart = new Date(`${todayDate}T00:00:00+05:45`).toISOString()
        const rangeEnd = new Date(`${addDays(todayDate, 1)}T00:00:00+05:45`).toISOString()

        const { data: firstEntry } = await supabase
            .from('day_book_entries')
            .select('created_at')
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('created_by', targetUserId)
            .gte('created_at', rangeStart)
            .lt('created_at', rangeEnd)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle()

        const { data: lastEntry } = await supabase
            .from('day_book_entries')
            .select('created_at')
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('created_by', targetUserId)
            .gte('created_at', rangeStart)
            .lt('created_at', rangeEnd)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        const clockIn = firstEntry?.created_at || new Date().toISOString()
        const clockOut = lastEntry?.created_at || new Date().toISOString()

        const { data: existingShift } = await supabase
            .from('staff_shifts')
            .select('id, user_id, restaurant_id, clock_in, clock_out, deduction_ledger_id')
            .eq('restaurant_id', currentUser.restaurantId)
            .eq('user_id', targetUserId)
            .eq('clock_in', clockIn)
            .maybeSingle()

        if (existingShift) {
            shift = existingShift
        } else {
            const { data: newShift, error: createErr } = await supabase
                .from('staff_shifts')
                .insert({
                    user_id: targetUserId,
                    restaurant_id: currentUser.restaurantId,
                    clock_in: clockIn,
                    clock_out: clockOut,
                })
                .select('id, user_id, restaurant_id, clock_in, clock_out, deduction_ledger_id')
                .single()

            if (createErr || !newShift) {
                return { error: createErr?.message || 'Failed to initialize shift record for reconciliation' }
            }
            shift = newShift
        }
    } else {
        const { data: existingShift } = await supabase
            .from('staff_shifts')
            .select('id, user_id, restaurant_id, clock_in, clock_out, deduction_ledger_id')
            .eq('id', shiftId)
            .single()

        shift = existingShift
    }

    if (!shift) return { error: 'Shift not found' }
    if (shift.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const windowEnd = shift.clock_out ?? new Date().toISOString()
    const expected = await computeShiftExpectedCash(supabase, shift.restaurant_id, shift.user_id, shift.clock_in, windowEnd)
    const counted = round2(countedAmount)
    const variance = round2(counted - expected)

    // Re-reconciliation: drop the old deduction before deciding on a new one.
    if (shift.deduction_ledger_id) {
        await supabase.from('staff_ledger').delete().eq('id', shift.deduction_ledger_id)
    }

    let deductionLedgerId: string | null = null
    if (variance < 0) {
        const { data: deduction, error: deductionError } = await supabase
            .from('staff_ledger')
            .insert({
                restaurant_id: shift.restaurant_id,
                user_id: shift.user_id,
                amount: Math.abs(variance),
                entry_type: 'deduction',
                payment_method: null,
                note: `Cash shortfall for shift ${new Date(shift.clock_in).toLocaleString()} – ${shift.clock_out ? new Date(shift.clock_out).toLocaleString() : 'now'} (expected ${expected.toFixed(2)}, counted ${counted.toFixed(2)})` + (note?.trim() ? ` — ${note.trim()}` : ''),
                created_by: currentUser.id,
            })
            .select('id')
            .single()

        if (deductionError) return { error: deductionError.message }
        deductionLedgerId = deduction.id
    }

    const { error: updateError } = await supabase
        .from('staff_shifts')
        .update({
            expected_cash_amount: expected,
            counted_cash_amount: counted,
            cash_variance: variance,
            cash_reconciled_at: new Date().toISOString(),
            cash_reconciled_by: currentUser.id,
            deduction_ledger_id: deductionLedgerId,
        })
        .eq('id', shift.id)

    if (updateError) return { error: updateError.message }

    void logAudit({
        restaurantId: shift.restaurant_id,
        userId: currentUser.id,
        action: 'shift_cash_reconciled',
        entityType: 'shift',
        entityId: shift.id,
        newValue: { expected, counted, variance },
    })

    revalidatePath('/admin/shift-cash')
    revalidatePath('/admin/staff')

    return { success: true, expected, counted, variance }
}
