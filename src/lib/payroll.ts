import { createAdminClient } from '@/lib/supabase/server'

type SupabaseAdminClient = Awaited<ReturnType<typeof createAdminClient>>

// NST = UTC+5:45. Used to align "which calendar day" a UTC timestamp falls on
// with the same NST-based month boundaries the accrual cron uses, so a staff
// member hired late in the UTC day (but already the next day in NST) isn't
// mis-prorated by a day.
const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000

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

    const [
        { data: staff, error: staffError },
        { data: existingAccruals, error: accrualError }
    ] = await Promise.all([
        supabase
            .from('users')
            .select('id, full_name, created_at, monthly_salary')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true),
        supabase
            .from('staff_ledger')
            .select('user_id')
            .eq('restaurant_id', restaurantId)
            .eq('entry_type', 'accrual')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString())
    ])

    if (staffError) throw new Error(staffError.message)
    if (accrualError) throw new Error(accrualError.message)

    const processedUserIds = new Set(existingAccruals?.map(a => a.user_id) || [])

    return staff.map(member => {
        const joinedDate = new Date(member.created_at)
        const isProcessed = processedUserIds.has(member.id)

        // Shift into NST before reading calendar components, so the "hire day"
        // lines up with the same NST-based month boundaries the cron uses.
        const joinedNst = new Date(joinedDate.getTime() + NST_OFFSET_MS)
        const joinedUTC = Date.UTC(joinedNst.getUTCFullYear(), joinedNst.getUTCMonth(), joinedNst.getUTCDate())

        let computedAmount = Number(member.monthly_salary)
        let note = 'Previous month salary'
        let daysWorked = totalDaysInMonth

        if (joinedUTC > endUTC) {
            computedAmount = 0
            note = 'Not hired yet during this period'
            daysWorked = 0
        } else if (joinedUTC > startUTC) {
            const joinedDay = new Date(joinedUTC).getUTCDate()
            daysWorked = totalDaysInMonth - joinedDay + 1
            computedAmount = Math.round(Number(member.monthly_salary) * (daysWorked / totalDaysInMonth) * 100) / 100
            note = `Previous month salary (Prorated: ${daysWorked}/${totalDaysInMonth} days)`
        }

        return {
            userId: member.id,
            fullName: member.full_name,
            joinedDate: member.created_at,
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
