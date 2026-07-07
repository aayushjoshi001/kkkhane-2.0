import { ReactNode } from 'react'
import FinanceNav from '@/components/finance/FinanceNav'

export default function FinanceLayout({ children }: { children: ReactNode }) {
    return (
        <div className="space-y-5">
            <div className="bg-surface p-5 md:p-6 rounded-[var(--radius-card)] border border-hairline shadow-sm space-y-4">
                <div>
                    <h1 className="text-2xl font-black text-ink">Finance</h1>
                    <p className="text-ink-subtle text-sm mt-1">
                        Structure preview — automatic posting, cross-module sync, and calculations arrive in a later phase.
                    </p>
                </div>
                <FinanceNav />
            </div>
            {children}
        </div>
    )
}
