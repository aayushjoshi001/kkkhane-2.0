import { createAdminClient } from '@/lib/supabase/server'
import { getEffectiveJoinDate } from '@/lib/timezone'

type SupabaseAdminClient = Awaited<ReturnType<typeof createAdminClient>>

export type AccrualPreviewItem = {
    userId: string
    fullName: string
    joinedDate: string
    monthlySalary: number
    computedAmount: number
    daysWorked: number
    totalDaysInMonth: number
    note: string
    isProcessed: boolean
}

// Computes each active staff member's salary accrual for a given month, prorating
// for anyone hired mid-month, and flags staff who already have an accrual entry
// recorded for that period. Shared by the manual "Process Monthly Salaries" UI
// action and the automatic monthly cron job.
export async function computeMonthlyAccrualPreview(
    supabase: SupabaseAdminClient,
    restaurantId: string,
    year: number,
    month: number
): Promise<AccrualPreviewItem[]> {
    const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
    const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
    const totalDaysInMonth = new Date(year, month, 0).getDate()
    const startUTC = Date.UTC(year, month - 1, 1)
    const endUTC = Date.UTC(year, month, 0)
    const startDateStr = startDate.toISOString().slice(0, 10)
    const endDateStr = endDate.toISOString().slice(0, 10)

    const [
        { data: staff, error: staffError },
        { data: existingAccruals, error: accrualError },
        { data: absences, error: absenceError },
        { data: salaryHistory, error: salaryHistoryError }
    ] = await Promise.all([
        supabase
            .from('users')
            .select('id, full_name, created_at, join_date, monthly_salary')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .is('deleted_at', null),
        supabase
            .from('staff_ledger')
            .select('user_id')
            .eq('restaurant_id', restaurantId)
            .eq('entry_type', 'accrual')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString()),
        supabase
            .from('staff_attendance')
            .select('user_id, date')
            .eq('restaurant_id', restaurantId)
            .eq('status', 'absent')
            .gte('date', startDateStr)
            .lte('date', endDateStr),
        supabase
            .from('staff_salary_history')
            .select('user_id, monthly_salary, effective_from, effective_to')
            .eq('restaurant_id', restaurantId)
            .lte('effective_from', endDateStr)
            .or(`effective_to.is.null,effective_to.gte.${startDateStr}`)
    ])

    if (staffError) throw new Error(staffError.message)
    if (accrualError) throw new Error(accrualError.message)
    if (absenceError) throw new Error(absenceError.message)
    if (salaryHistoryError) throw new Error(salaryHistoryError.message)

    const processedUserIds = new Set(existingAccruals?.map(a => a.user_id) || [])

    const absentDatesByUser = new Map<string, Set<string>>()
    for (const row of absences || []) {
        if (!absentDatesByUser.has(row.user_id)) absentDatesByUser.set(row.user_id, new Set())
        absentDatesByUser.get(row.user_id)!.add(row.date)
    }

    const salarySegmentsByUser = new Map<string, Array<{ from: string; to: string | null; salary: number }>>()
    for (const row of salaryHistory || []) {
        if (!salarySegmentsByUser.has(row.user_id)) salarySegmentsByUser.set(row.user_id, [])
        salarySegmentsByUser.get(row.user_id)!.push({ from: row.effective_from, to: row.effective_to, salary: Number(row.monthly_salary) })
    }

    return staff.map(member => {
        const isProcessed = processedUserIds.has(member.id)

        // Same join-date resolution actions.ts uses when backfilling salary
        // history, so the two never disagree over a staff member's join day.
        const joinDateStr = getEffectiveJoinDate(member.join_date, member.created_at)
        const [jy, jm, jd] = joinDateStr.split('-').map(Number)
        const joinedUTC = Date.UTC(jy, jm - 1, jd)

        let computedAmount = 0
        let note = 'Previous month salary'
        let daysWorked = totalDaysInMonth

        if (joinedUTC > endUTC) {
            note = 'Not hired yet during this period'
            daysWorked = 0
        } else {
            // Walk each day the member could have worked this month, using
            // whichever salary segment (or the flat fallback rate) covers
            // that specific day, and skipping days marked absent — so a
            // mid-month raise or an absence only affects the days it
            // actually applies to.
            const absentDates = absentDatesByUser.get(member.id)
            const segments = salarySegmentsByUser.get(member.id)
            const fallbackRate = Number(member.monthly_salary)

            let paidDays = 0
            let absentDays = 0
            let rawAmount = 0

            for (let d = Math.max(startUTC, joinedUTC); d <= endUTC; d += 86400000) {
                const dateStr = new Date(d).toISOString().slice(0, 10)
                if (absentDates?.has(dateStr)) {
                    absentDays++
                    continue
                }
                const segment = segments?.find(s => s.from <= dateStr && (!s.to || s.to >= dateStr))
                rawAmount += (segment ? segment.salary : fallbackRate) / totalDaysInMonth
                paidDays++
            }

            daysWorked = paidDays
            computedAmount = Math.round(rawAmount * 100) / 100
            note = daysWorked === totalDaysInMonth
                ? 'Previous month salary'
                : `Previous month salary (Prorated: ${daysWorked}/${totalDaysInMonth} days${absentDays > 0 ? `, ${absentDays} absent` : ''})`
        }

        return {
            userId: member.id,
            fullName: member.full_name,
            joinedDate: joinDateStr,
            monthlySalary: Number(member.monthly_salary),
            computedAmount,
            daysWorked,
            totalDaysInMonth,
            note,
            isProcessed
        }
    })
}

// Inserts 'accrual' ledger entries for the given preview items, dated to the
// last moment of the accrued period. Skips items with a zero amount.
// createdBy is null for system-triggered (cron) accruals, or the manager's
// user id when triggered manually from the UI.
export async function insertAccruals(
    supabase: SupabaseAdminClient,
    restaurantId: string,
    year: number,
    month: number,
    items: Array<{ userId: string; amount: number; note: string }>,
    createdBy: string | null = null
) {
    const toInsert = items.filter(i => i.amount > 0)
    if (toInsert.length === 0) return { inserted: 0 }

    const accrualDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString()

    const { error } = await supabase
        .from('staff_ledger')
        .insert(toInsert.map(i => ({
            restaurant_id: restaurantId,
            user_id: i.userId,
            amount: i.amount,
            entry_type: 'accrual',
            payment_method: null,
            note: i.note,
            created_by: createdBy,
            created_at: accrualDate
        })))

    if (error) throw new Error(error.message)
    return { inserted: toInsert.length }
}
