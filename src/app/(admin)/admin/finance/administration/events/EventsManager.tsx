'use client'

import { useState, useTransition } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Search, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { StatusBadge } from '@/components/ui/Badge'
import { FormModal } from '@/components/finance'
import { formatCurrency } from '@/lib/utils'
import { FINANCIAL_EVENT_TYPES, FINANCIAL_EVENT_STATUSES, type FinancialEvent, type FinancialEventStatus, type FinancialEventType } from '@/types/database'
import type { SearchFinancialEventsFilters } from '@/lib/finance-events/repository'
import { searchEventsAction, retryEventAction } from './actions'

const PAGE_SIZE = 20

interface FiltersState {
    status: FinancialEventStatus | ''
    eventType: FinancialEventType | ''
    dateFrom: string
    dateTo: string
    query: string
}

const EMPTY_FILTERS: FiltersState = { status: '', eventType: '', dateFrom: '', dateTo: '', query: '' }

export default function EventsManager({ initialRows, initialTotal }: { initialRows: FinancialEvent[]; initialTotal: number }) {
    const [rows, setRows] = useState(initialRows)
    const [total, setTotal] = useState(initialTotal)
    const [page, setPage] = useState(1)
    const [filters, setFilters] = useState<FiltersState>(EMPTY_FILTERS)
    const [selected, setSelected] = useState<FinancialEvent | null>(null)
    const [isPending, startTransition] = useTransition()
    const [retryingId, setRetryingId] = useState<string | null>(null)

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

    function runSearch(nextFilters: FiltersState, nextPage: number) {
        startTransition(async () => {
            const query: SearchFinancialEventsFilters = {
                status: nextFilters.status || undefined,
                eventType: nextFilters.eventType || undefined,
                dateFrom: nextFilters.dateFrom || undefined,
                dateTo: nextFilters.dateTo || undefined,
                query: nextFilters.query || undefined,
                page: nextPage,
                pageSize: PAGE_SIZE,
            }
            const result = await searchEventsAction(query)
            if (result.error) { toast.error(result.error); return }
            setRows(result.data!.rows)
            setTotal(result.data!.total)
            setPage(nextPage)
        })
    }

    function updateFilter<K extends keyof FiltersState>(key: K, value: FiltersState[K]) {
        const next = { ...filters, [key]: value }
        setFilters(next)
        runSearch(next, 1)
    }

    async function handleRetry(id: string) {
        setRetryingId(id)
        const result = await retryEventAction(id)
        setRetryingId(null)
        if (result.error) { toast.error(result.error); return }
        toast.success('Event queued for retry (status reset to PENDING)')
        runSearch(filters, page)
        setSelected(null)
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-subtle">
                Every event created here stops at PENDING — this phase only builds the event log; the posting engine that acts on these arrives in a later step.
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                        value={filters.query}
                        onChange={(e) => updateFilter('query', e.target.value)}
                        placeholder="Search event code, description, reference..."
                        className="w-full pl-9 pr-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                    />
                </div>
                <select
                    value={filters.status}
                    onChange={(e) => updateFilter('status', e.target.value as FinancialEventStatus | '')}
                    className="px-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink-muted font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                    <option value="">All statuses</option>
                    {FINANCIAL_EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select
                    value={filters.eventType}
                    onChange={(e) => updateFilter('eventType', e.target.value as FinancialEventType | '')}
                    className="px-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink-muted font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                    <option value="">All event types</option>
                    {FINANCIAL_EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => updateFilter('dateFrom', e.target.value)}
                    className="px-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => updateFilter('dateTo', e.target.value)}
                    className="px-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
            </div>

            <div className="bg-surface rounded-[var(--radius-card)] border border-hairline overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/30">
                            <tr>
                                {['Event Code', 'Type', 'Source', 'Business Date', 'Amount', 'Status', 'Retries', ''].map((h) => (
                                    <th key={h} className="px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-ink-subtle text-left whitespace-nowrap">{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-4 py-10">
                                        <EmptyState icon={Zap} title="No financial events yet" description="Nothing dispatches events yet — this list populates once business modules are wired into the engine." compact />
                                    </td>
                                </tr>
                            ) : (
                                rows.map((ev) => (
                                    <tr key={ev.id} className="cursor-pointer hover:bg-surface-muted/40 transition-colors" onClick={() => setSelected(ev)}>
                                        <td className="px-4 py-3 font-mono text-xs font-bold">{ev.event_code}</td>
                                        <td className="px-4 py-3">{ev.event_type}</td>
                                        <td className="px-4 py-3 text-ink-subtle text-xs">{ev.source_module}</td>
                                        <td className="px-4 py-3">{new Date(ev.business_date).toLocaleDateString()}</td>
                                        <td className="px-4 py-3">{formatCurrency(ev.amount, ev.currency)}</td>
                                        <td className="px-4 py-3"><StatusBadge status={ev.status} /></td>
                                        <td className="px-4 py-3">{ev.retry_count}</td>
                                        <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                            {ev.status === 'FAILED' && (
                                                <Button size="sm" variant="ghost" icon={RotateCcw} loading={retryingId === ev.id} onClick={() => handleRetry(ev.id)}>Retry</Button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
                    <p className="text-xs text-ink-subtle">
                        Page {page} of {totalPages} · {total} total{isPending ? ' · loading…' : ''}
                    </p>
                    <div className="flex items-center gap-1">
                        <button disabled={page <= 1 || isPending} onClick={() => runSearch(filters, page - 1)} className="w-8 h-8 rounded-lg border border-hairline-strong flex items-center justify-center disabled:opacity-40 hover:bg-surface-muted">
                            <ChevronLeft size={14} />
                        </button>
                        <button disabled={page >= totalPages || isPending} onClick={() => runSearch(filters, page + 1)} className="w-8 h-8 rounded-lg border border-hairline-strong flex items-center justify-center disabled:opacity-40 hover:bg-surface-muted">
                            <ChevronRight size={14} />
                        </button>
                    </div>
                </div>
            </div>

            <FormModal open={!!selected} onClose={() => setSelected(null)} title={selected?.event_code ?? ''} maxWidth="xl">
                {selected && (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <Field label="Event Type" value={selected.event_type} />
                            <Field label="Status" value={<StatusBadge status={selected.status} />} />
                            <Field label="Source Module" value={selected.source_module} />
                            <Field label="Source ID" value={selected.source_id || '—'} />
                            <Field label="Business Date" value={new Date(selected.business_date).toLocaleDateString()} />
                            <Field label="Accounting Date" value={new Date(selected.accounting_date).toLocaleDateString()} />
                            <Field label="Amount" value={formatCurrency(selected.amount, selected.currency)} />
                            <Field label="Reference Number" value={selected.reference_number || '—'} />
                            <Field label="Retry Count" value={String(selected.retry_count)} />
                            <Field label="Processed At" value={selected.processed_at ? new Date(selected.processed_at).toLocaleString() : '—'} />
                            <Field label="Supplier" value={selected.suppliers?.name || '—'} />
                            <Field label="Payment Method" value={selected.finance_payment_methods?.name || '—'} />
                        </div>
                        {selected.description && (
                            <div>
                                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1">Description</p>
                                <p className="text-sm text-ink">{selected.description}</p>
                            </div>
                        )}
                        {selected.metadata && (
                            <div>
                                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1">Metadata</p>
                                <pre className="text-xs bg-surface-muted rounded-xl p-3 overflow-x-auto">{JSON.stringify(selected.metadata, null, 2)}</pre>
                            </div>
                        )}
                        {selected.status === 'FAILED' && (
                            <Button icon={RotateCcw} loading={retryingId === selected.id} onClick={() => handleRetry(selected.id)}>Retry Event</Button>
                        )}
                    </div>
                )}
            </FormModal>
        </div>
    )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div>
            <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wide">{label}</p>
            <div className="font-semibold text-ink mt-0.5">{value}</div>
        </div>
    )
}
