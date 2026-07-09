'use client'

import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import { DataTable, PlaceholderChart, SectionTabs, type SectionTab } from '@/components/finance'
import { formatCurrency } from '@/lib/utils'
import type { DayBookEntry } from '@/types/database'

function formatDescription(desc: string): string {
    if (!desc) return ''
    if (desc.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(desc)
            if (parsed.voucher_type && parsed.voucher_number) {
                const typeLabel = parsed.voucher_type === 'receipt' ? 'Receipt' : 'Payment'
                const partyLabel = parsed.party_name ? ` (To: ${parsed.party_name})` : ''
                const receivedFromLabel = parsed.party_name && parsed.voucher_type === 'receipt' ? ` (From: ${parsed.party_name})` : partyLabel
                return `${typeLabel} ${parsed.voucher_number}${receivedFromLabel} - ${parsed.particulars || 'No details'}`
            }
        } catch {
            // fallback
        }
    }
    return desc
}

export default function BooksManager({ entries }: { entries: DayBookEntry[] }) {
    const [tab, setTab] = useState('daybook')

    const cashEntries = entries.filter((e) => e.type === 'cash_in' || e.type === 'cash_out')
    const bankEntries = entries.filter((e) => e.type === 'bank_in' || e.type === 'bank_out')

    const tabs: SectionTab[] = [
        { key: 'daybook', label: 'Daybook', count: entries.length },
        { key: 'cashbook', label: 'Cash Book', count: cashEntries.length },
        { key: 'bankbook', label: 'Bank Book', count: bankEntries.length },
        { key: 'general', label: 'General Ledger' },
        { key: 'customer', label: 'Customer Ledger' },
        { key: 'supplier', label: 'Supplier Ledger' },
        { key: 'account', label: 'Account Ledger' },
    ]

    const rows = tab === 'cashbook' ? cashEntries : tab === 'bankbook' ? bankEntries : entries

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {(tab === 'daybook' || tab === 'cashbook' || tab === 'bankbook') && (
                <DataTable
                    columns={[
                        { key: 'created_at', header: 'Date', render: (e) => new Date(e.created_at).toLocaleString(), sortValue: (e) => e.created_at },
                        { key: 'type', header: 'Type', render: (e) => e.type },
                        { key: 'category', header: 'Category', render: (e) => e.category },
                        { key: 'description', header: 'Description', render: (e) => formatDescription(e.description) },
                        { key: 'amount', header: 'Amount', align: 'right', render: (e) => formatCurrency(e.amount), sortValue: (e) => e.amount },
                    ]}
                    rows={rows}
                    rowKey={(e) => e.id}
                    searchKeys={(e) => [e.description, e.category]}
                    emptyIcon={BookOpen}
                    emptyTitle="No entries yet"
                    emptyDescription="Read-only view of the existing Day Book ledger — entries are still recorded manually from the Day Book page."
                />
            )}
            {(tab === 'general' || tab === 'customer' || tab === 'supplier' || tab === 'account') && (
                <PlaceholderChart
                    icon={BookOpen}
                    height={280}
                    title={tabs.find((t) => t.key === tab)?.label ?? 'Ledger'}
                    description="Awaiting the Chart of Accounts and posting engine — this ledger will populate once transactions post against real accounts."
                />
            )}
        </div>
    )
}
