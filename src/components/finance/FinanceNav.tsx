'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
    LayoutDashboard, Wallet, Landmark, TrendingUp, Receipt, HandCoins, ArrowUpRight,
    Banknote, PiggyBank, Percent, BookOpen, FileBarChart, FileText, Settings2, ShieldCheck, Wrench,
    type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const CATEGORIES: { label: string; items: { href: string; label: string; icon: LucideIcon }[] }[] = [
    {
        label: 'Overview',
        items: [
            { href: '/admin/finance', label: 'Dashboard', icon: LayoutDashboard },
        ],
    },
    {
        label: 'Cash & Bank',
        items: [
            { href: '/admin/finance/cash', label: 'Cash Management', icon: Wallet },
            { href: '/admin/finance/bank', label: 'Bank Management', icon: Landmark },
        ],
    },
    {
        label: 'Revenue & Spend',
        items: [
            { href: '/admin/finance/income', label: 'Income', icon: TrendingUp },
            { href: '/admin/finance/expenses', label: 'Expenses', icon: Receipt },
            { href: '/admin/finance/receivables', label: 'Receivables', icon: HandCoins },
            { href: '/admin/finance/payables', label: 'Payables', icon: ArrowUpRight },
        ],
    },
    {
        label: 'Planning',
        items: [
            { href: '/admin/finance/loans', label: 'Loans', icon: Banknote },
            { href: '/admin/finance/budget', label: 'Budget', icon: PiggyBank },
            { href: '/admin/finance/tax', label: 'Tax', icon: Percent },
        ],
    },
    {
        label: 'Books & Reports',
        items: [
            { href: '/admin/finance/books', label: 'Financial Books', icon: BookOpen },
            { href: '/admin/finance/statements', label: 'Financial Statements', icon: FileBarChart },
            { href: '/admin/finance/reports', label: 'Reports', icon: FileText },
        ],
    },
    {
        label: 'Admin',
        items: [
            { href: '/admin/finance/administration', label: 'Administration', icon: Settings2 },
            { href: '/admin/finance/audit', label: 'Audit', icon: ShieldCheck },
            { href: '/admin/finance/tools', label: 'Tools', icon: Wrench },
        ],
    },
]

/** Horizontal sub-nav across the Finance sections, grouped by category. Mirrors AdminSidebar's active-state logic. */
export default function FinanceNav() {
    const pathname = usePathname()
    return (
        <nav className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
            {CATEGORIES.map(({ label, items }, i) => (
                <div key={label} className="flex items-center gap-1 shrink-0">
                    {i > 0 && <div className="w-px h-5 bg-hairline mx-1.5 shrink-0" />}
                    <span className="hidden lg:inline text-[10px] font-extrabold uppercase tracking-wider text-ink-subtle/60 px-1.5 shrink-0">
                        {label}
                    </span>
                    {items.map(({ href, label: itemLabel, icon: Icon }) => {
                        const isActive = href === '/admin/finance' ? pathname === href : pathname.startsWith(href)
                        return (
                            <Link
                                key={href}
                                href={href}
                                prefetch={true}
                                className={cn(
                                    'flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-colors shrink-0',
                                    isActive ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                                )}
                            >
                                <Icon size={14} />
                                {itemLabel}
                            </Link>
                        )
                    })}
                </div>
            ))}
        </nav>
    )
}
