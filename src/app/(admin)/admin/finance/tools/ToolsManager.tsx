'use client'

import { useState } from 'react'
import { Search, Upload, Download, DatabaseBackup, History } from 'lucide-react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { financeSearchAction, type FinanceSearchResult } from './actions'

const TOOLS = [
    { icon: Upload, label: 'Import', description: 'Bulk-import finance master data from a spreadsheet.' },
    { icon: Download, label: 'Export', description: 'Export finance records for external accounting tools.' },
    { icon: DatabaseBackup, label: 'Backup', description: 'Snapshot finance data for safekeeping.' },
    { icon: History, label: 'Restore', description: 'Restore finance data from a previous backup.' },
]

export default function ToolsManager() {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<FinanceSearchResult[] | null>(null)
    const [searching, setSearching] = useState(false)

    async function handleSearch(e: React.FormEvent) {
        e.preventDefault()
        setSearching(true)
        const result = await financeSearchAction(query)
        setSearching(false)
        setResults(result.data ?? [])
    }

    return (
        <div className="space-y-6">
            <Card>
                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-3">Financial Search</p>
                <form onSubmit={handleSearch} className="flex gap-2">
                    <div className="relative flex-1">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search cash drawers, banks, suppliers, accounts, categories..."
                            className="w-full pl-9 pr-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                        />
                    </div>
                    <Button type="submit" loading={searching}>Search</Button>
                </form>
                {results && (
                    results.length === 0 ? (
                        <EmptyState icon={Search} title="No matches" compact className="mt-4" />
                    ) : (
                        <div className="mt-4 divide-y divide-hairline border border-hairline rounded-xl overflow-hidden">
                            {results.map((r, i) => (
                                <a key={i} href={r.href} className="flex items-center justify-between px-4 py-3 text-sm hover:bg-surface-muted/50 transition-colors">
                                    <span className="font-semibold text-ink">{r.label}</span>
                                    <span className="text-[10px] font-bold text-ink-subtle uppercase">{r.type}</span>
                                </a>
                            ))}
                        </div>
                    )
                )}
            </Card>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {TOOLS.map(({ icon: Icon, label, description }) => (
                    <Card key={label} className="flex items-start gap-3">
                        <span className="grid place-items-center size-10 rounded-full bg-surface-muted text-ink-subtle shrink-0">
                            <Icon size={18} />
                        </span>
                        <div className="flex-1">
                            <p className="font-bold text-ink text-sm">{label}</p>
                            <p className="text-xs text-ink-subtle mt-0.5">{description}</p>
                        </div>
                        <Button size="sm" variant="secondary" disabled>Coming Soon</Button>
                    </Card>
                ))}
            </div>
        </div>
    )
}
