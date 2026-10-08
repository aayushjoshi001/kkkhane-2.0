import Link from 'next/link'
import {
    Wallet, Landmark, Receipt, ArrowUpRight, Banknote, PiggyBank,
    TrendingUp, HandCoins, Percent, BookOpen,
} from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { getCurrentUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import StatCard from '@/components/ui/StatCard'
import Card from '@/components/ui/Card'
import { PlaceholderChart } from '@/components/finance'

export const revalidate = 0

async function countRows(supabase: Awaited<ReturnType<typeof createAdminClient>>, table: string, restaurantId: string, extra?: (q: any) => any) {
    let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq('restaurant_id', restaurantId)
    if (extra) query = extra(query)
    const { count } = await query
    return count ?? 0
}

export default async function FinanceDashboardPage() {
    const { restaurantId } = await getCurrentUser()
    const supabase = await createAdminClient()

    const [
        cashDrawers, bankAccounts, pendingExpenses, unpaidBills,
        activeLoans, activeBudgets, incomeEntries, taxFilings,
    ] = await Promise.all([
        countRows(supabase, 'cash_drawers', restaurantId, (q) => q.eq('is_active', true)),
        countRows(supabase, 'bank_accounts', restaurantId, (q) => q.eq('is_active', true)),
        countRows(supabase, 'expenses', restaurantId, (q) => q.eq('status', 'pending')),
        countRows(supabase, 'supplier_bills', restaurantId, (q) => q.neq('status', 'paid')),
        countRows(supabase, 'loans', restaurantId, (q) => q.eq('status', 'active')),
        countRows(supabase, 'budgets', restaurantId, (q) => q.eq('status', 'active')),
        countRows(supabase, 'income_entries', restaurantId),
        countRows(supabase, 'tax_filings', restaurantId, (q) => q.eq('status', 'draft')),
    ])

    const quickActions: { href: string; label: string; icon: typeof Wallet }[] = [
        { href: '/admin/finance/cash', label: 'Record Cash Transaction', icon: Wallet },
        { href: '/admin/finance/bank', label: 'Record Bank Transaction', icon: Landmark },
        { href: '/admin/finance/expenses', label: 'Log an Expense', icon: Receipt },
        { href: '/admin/finance/payables', label: 'Add a Supplier Bill', icon: ArrowUpRight },
        { href: '/admin/finance/income', label: 'Record Income', icon: TrendingUp },
        { href: '/admin/finance/loans', label: 'Manage Loans', icon: Banknote },
    ]

    return (
        <div className="space-y-6">
            <PremiumPageHeader title="Finance" description="Financial overview — accounts, reports, and modules at a glance." icon={<TrendingUp size={18} />} color="orange" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="Active Cash Drawers" value={cashDrawers} icon={Wallet} tone="brand" />
                <StatCard label="Active Bank Accounts" value={bankAccounts} icon={Landmark} tone="info" />
                <StatCard label="Pending Expenses" value={pendingExpenses} icon={Receipt} tone="warning" />
                <StatCard label="Outstanding Supplier Bills" value={unpaidBills} icon={ArrowUpRight} tone="danger" />
                <StatCard label="Active Loans" value={activeLoans} icon={Banknote} tone="neutral" />
                <StatCard label="Active Budgets" value={activeBudgets} icon={PiggyBank} tone="success" />
                <StatCard label="Income Entries Logged" value={incomeEntries} icon={TrendingUp} tone="brand" />
                <StatCard label="Draft Tax Filings" value={taxFilings} icon={Percent} tone="warning" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <PlaceholderChart icon={TrendingUp} title="Income vs Expense" description="Populates once the posting engine reconciles recorded entries against the ledger." />
                <PlaceholderChart icon={BookOpen} title="Cash Flow" description="Populates once Cash & Bank transactions post automatically from every module." />
            </div>

            <Card>
                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-3">Quick Actions</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {quickActions.map(({ href, label, icon: Icon }) => (
                        <Link
                            key={href}
                            href={href}
                            className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-hairline bg-surface hover:border-brand-300 hover:bg-brand-50/40 transition-colors text-sm font-bold text-ink-muted hover:text-brand-600"
                        >
                            <Icon size={16} />
                            {label}
                        </Link>
                    ))}
                </div>
            </Card>

            <Card>
                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-2">Recent Activity</p>
                <p className="text-sm text-ink-subtle flex items-center gap-2">
                    <HandCoins size={16} className="text-ink-subtle" />
                    A live feed of financial events will appear here once the Financial Event Engine is wired in.
                </p>
            </Card>
        </div>
    )
}
