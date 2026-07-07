'use client'

import { useState } from 'react'
import { FileBarChart, Download } from 'lucide-react'
import { PlaceholderChart, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

const STATEMENTS: SectionTab[] = [
    { key: 'trial_balance', label: 'Trial Balance' },
    { key: 'profit_loss', label: 'Profit & Loss' },
    { key: 'balance_sheet', label: 'Balance Sheet' },
    { key: 'cash_flow', label: 'Cash Flow Statement' },
    { key: 'equity', label: 'Statement of Equity' },
]

export default function FinanceStatementsPage() {
    const [tab, setTab] = useState('trial_balance')
    const active = STATEMENTS.find((s) => s.key === tab)

    return (
        <div className="space-y-4">
            <SectionTabs tabs={STATEMENTS} active={tab} onChange={setTab} />
            <Card>
                <div className="flex items-center justify-between mb-4">
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">{active?.label}</p>
                    <Button size="sm" variant="secondary" icon={Download} disabled>Export</Button>
                </div>
                <PlaceholderChart
                    icon={FileBarChart}
                    height={320}
                    title={`${active?.label} not yet available`}
                    description="Financial statements are computed from the Chart of Accounts and posted transactions — both arrive in a later phase."
                />
            </Card>
        </div>
    )
}
