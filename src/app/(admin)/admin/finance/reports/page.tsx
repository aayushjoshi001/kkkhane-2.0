'use client'

import { useState } from 'react'
import { FileText, Download } from 'lucide-react'
import { PlaceholderChart, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const REPORTS: SectionTab[] = [
    { key: 'sales', label: 'Sales Reports' },
    { key: 'expense', label: 'Expense Reports' },
    { key: 'cash', label: 'Cash Reports' },
    { key: 'bank', label: 'Bank Reports' },
    { key: 'payment', label: 'Payment Reports' },
    { key: 'branch', label: 'Branch Reports' },
    { key: 'profit', label: 'Profit Reports' },
    { key: 'summary', label: 'Financial Summary' },
]

const BRANCH_NOTE = 'This system currently operates as a single location — branch-level breakdowns will apply once multi-branch support exists.'

export default function FinanceReportsPage() {
    const [tab, setTab] = useState('sales')
    const active = REPORTS.find((r) => r.key === tab)

    return (
        <div className="space-y-4">
            <SectionTabs tabs={REPORTS} active={tab} onChange={setTab} />
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">{active?.label}</p>
                    <Button size="sm" variant="secondary" icon={Download} disabled>Export</Button>
                </div>
                <PlaceholderChart
                    icon={FileText}
                    height={320}
                    title={`${active?.label} not yet available`}
                    description={tab === 'branch' ? BRANCH_NOTE : 'Report calculations arrive once the Financial Event Engine and ledger are wired in.'}
                />
            </Card>
        </div>
    )
}
