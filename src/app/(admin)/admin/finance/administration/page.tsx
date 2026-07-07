import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { searchEvents } from '@/lib/finance-events/service'
import AdministrationManager from './AdministrationManager'

export const revalidate = 0

export default async function FinanceAdministrationPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [
        { data: accounts },
        { data: voucherTypes },
        { data: paymentMethods },
        { data: approvalLevels },
        { data: fiscalYears },
        { data: periods },
        { data: settings },
        { data: permissions },
        events,
    ] = await Promise.all([
        supabase.from('chart_of_accounts').select('*, parent:parent_id(*)').eq('restaurant_id', restaurantId).order('code', { ascending: true }),
        supabase.from('voucher_types').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('finance_payment_methods').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('approval_levels').select('*').eq('restaurant_id', restaurantId).order('level_order', { ascending: true }),
        supabase.from('fiscal_years').select('*').eq('restaurant_id', restaurantId).order('start_date', { ascending: false }),
        supabase.from('accounting_periods').select('*, fiscal_years(*)').eq('restaurant_id', restaurantId).order('start_date', { ascending: false }),
        supabase.from('finance_settings').select('*').eq('restaurant_id', restaurantId).maybeSingle(),
        supabase.from('finance_role_permissions').select('*').eq('restaurant_id', restaurantId).order('role_name', { ascending: true }),
        searchEvents({ page: 1, pageSize: 20 }),
    ])

    return (
        <AdministrationManager
            initialAccounts={accounts || []}
            initialVoucherTypes={voucherTypes || []}
            initialPaymentMethods={paymentMethods || []}
            initialApprovalLevels={approvalLevels || []}
            initialFiscalYears={fiscalYears || []}
            initialPeriods={periods || []}
            initialSettings={settings || null}
            initialPermissions={permissions || []}
            initialEvents={events.data?.rows || []}
            initialEventsTotal={events.data?.total || 0}
        />
    )
}
