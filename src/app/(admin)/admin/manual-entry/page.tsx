import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveActiveDayBookSession } from '@/lib/ledger'
import ManualEntryClient from './ManualEntryClient'

export const dynamic = 'force-dynamic'

export default async function ManualEntryPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const { getRestaurantFeatures } = await import('@/lib/features')
    const features = await getRestaurantFeatures(currentUser.restaurantId)
    if (!features?.financeEnabled || !features?.manualEntryEnabled) {
        redirect('/admin/dashboard')
    }

    const supabase = await createAdminClient()
    const restaurantId = currentUser.restaurantId

    // Fetch all seed data in parallel
    const [
        { data: bankAccounts },
        { data: suppliers },
        { data: staff },
        { data: expenseCategories },
        { data: ingredients },
    ] = await Promise.all([
        supabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('suppliers')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('users')
            .select('id, full_name')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('full_name', { ascending: true }),
        supabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('ingredients')
            .select('id, name, unit, stock_quantity')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
    ])

    const openSession = await resolveActiveDayBookSession(supabase, restaurantId, currentUser.id)

    return (
        <ManualEntryClient
            bankAccounts={bankAccounts || []}
            suppliers={suppliers || []}
            staffList={staff || []}
            expenseCategories={expenseCategories || []}
            ingredients={ingredients || []}
            hasOpenSession={!!openSession}
            sessionId={openSession?.id ?? null}
            userRole={currentUser.role}
        />
    )
}
