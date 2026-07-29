import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import ShiftsManager from './ShiftsManager'

import { redirect } from 'next/navigation'
import { getRestaurantFeatures } from '@/lib/features'

export const revalidate = 0

export default async function AdminShiftsPage() {
    const { restaurantId: rid } = await getCurrentUser()
    const features = await getRestaurantFeatures(rid)
    if (!features?.staffShiftsEnabled) {
        redirect('/admin/dashboard')
    }
    const adminSupabase = await createAdminClient()

    const [{ data: active }, { data: recent }] = await Promise.all([
        adminSupabase.from('staff_shifts').select('*, users(full_name, role_id, roles(name))')
            .eq('restaurant_id', rid).is('clock_out', null).order('clock_in', { ascending: false }),
        adminSupabase.from('staff_shifts').select('*, users(full_name, role_id, roles(name))')
            .eq('restaurant_id', rid).not('clock_out', 'is', null)
            .order('clock_in', { ascending: false }).limit(50),
    ])

    return (
        <div className="space-y-6">
            <div className="bg-surface p-6 rounded-xl border border-hairline-strong shadow-sm">
                <h1 className="text-2xl font-bold text-ink">Staff Shifts</h1>
                <p className="text-ink-subtle mt-1">Monitor active shifts and approve past timecards.</p>
            </div>
            <ShiftsManager activeShifts={active || []} recentShifts={recent || []} />
        </div>
    )
}
