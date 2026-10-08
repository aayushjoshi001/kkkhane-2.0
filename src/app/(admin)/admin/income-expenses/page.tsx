import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { Receipt } from 'lucide-react'
import IncomeExpensesManager from './IncomeExpensesManager'

import { getRestaurantFeatures } from '@/lib/features'
import { attachCreatorNames } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

export default async function IncomeExpensesPage() {
    const currentUser = await getCurrentUser()
    if (!currentUser || !currentUser.restaurantId) redirect('/login')

    const restaurantId = currentUser.restaurantId
    const features = await getRestaurantFeatures(restaurantId)
    if (!features?.financeEnabled) redirect('/admin/dashboard')

    const supabase = await createAdminClient()

    // Fetch categories, entries, suppliers, and bank accounts in parallel
    const [
        { data: incomeCategories },
        { data: expenseCategories },
        { data: incomeEntries },
        { data: expenses },
        { data: suppliers },
        { data: bankAccounts },
        { data: qrCodes }
    ] = await Promise.all([
        supabase
            .from('income_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('expense_categories')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('income_entries')
            .select('*, income_categories(*), bank_accounts(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(200),
        supabase
            .from('expenses')
            .select('*, expense_categories(*), bank_accounts(*)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
            .limit(200),
        supabase
            .from('suppliers')
            .select('id, name')
            .eq('restaurant_id', restaurantId)
            .order('name', { ascending: true }),
        supabase
            .from('bank_accounts')
            .select('*')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
            .order('name', { ascending: true }),
        supabase
            .from('payment_qr_codes')
            .select('label, bank_account_id')
            .eq('restaurant_id', restaurantId)
            .eq('is_active', true)
    ])

    const [namedIncomeEntries, namedExpenses] = await Promise.all([
        attachCreatorNames(supabase, incomeEntries || []),
        attachCreatorNames(supabase, expenses || []),
    ])

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Income & Expenses" description="Log income sources and track expense categories across your business." icon={<Receipt size={18} />} color="orange" />
            <IncomeExpensesManager
                initialIncomeCategories={incomeCategories || []}
                initialExpenseCategories={expenseCategories || []}
                initialIncomeEntries={namedIncomeEntries}
                initialExpenses={namedExpenses}
                suppliers={suppliers || []}
                bankAccounts={bankAccounts || []}
                qrCodes={qrCodes || []}
            />
        </div>
    )
}
