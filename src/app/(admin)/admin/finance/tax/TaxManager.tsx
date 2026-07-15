'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, Percent, Loader2, ChevronDown, ChevronUp, AlertCircle, FileText, CheckCircle, Calculator } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import type { TaxConfiguration, TaxFiling, TaxType } from '@/types/database'
import {
    createTaxConfigurationAction, updateTaxConfigurationAction, deleteTaxConfigurationAction,
    createTaxFilingAction, markTaxFilingFiledAction, deleteTaxFilingAction,
    calculateVatFilingSummaryAction
} from './actions'
import { getIrdSyncLogsAction, retryIrdSyncAction } from './sync-actions'

const fmt = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(n))}`

export default function TaxManager({
    initialConfigurations,
    initialFilings,
    initialSyncLogs,
    restaurantTax,
}: {
    initialConfigurations: TaxConfiguration[]
    initialFilings: TaxFiling[]
    initialSyncLogs: any[]
    restaurantTax: { pan_number: string | null; vat_registered: boolean; vat_number: string | null }
}) {
    const [tab, setTab] = useState('vat')
    const [configurations, setConfigurations] = useState(initialConfigurations)
    const [filings, setFilings] = useState(initialFilings)

    const tabs: SectionTab[] = [
        { key: 'vat', label: 'VAT & PAN Configurations', count: configurations.length },
        { key: 'filings', label: 'VAT Return, Summary & IRD Filings', count: filings.length },
        { key: 'logs', label: 'Nepal IRD API Sync Logs', count: initialSyncLogs.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'vat' && <VatTab restaurantTax={restaurantTax} configurations={configurations} setConfigurations={setConfigurations} />}
            {tab === 'filings' && <FilingsTab configurations={configurations} filings={filings} setFilings={setFilings} restaurantTax={restaurantTax} />}
            {tab === 'logs' && <IrdSyncLogsTab initialLogs={initialSyncLogs} restaurantTax={restaurantTax} />}
        </div>
    )
}

function VatTab({
    restaurantTax,
    configurations,
    setConfigurations,
}: {
    restaurantTax: { pan_number: string | null; vat_registered: boolean; vat_number: string | null }
    configurations: TaxConfiguration[]
    setConfigurations: (fn: (prev: TaxConfiguration[]) => TaxConfiguration[]) => void
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', tax_type: 'vat' as TaxType, rate_percent: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createTaxConfigurationAction({ name: form.name, tax_type: form.tax_type, rate_percent: form.rate_percent ? parseFloat(form.rate_percent) : undefined })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setConfigurations((prev) => [result.data as TaxConfiguration, ...prev])
        toast.success('Tax configuration created')
        setOpen(false)
        setForm({ name: '', tax_type: 'vat', rate_percent: '' })
    }

    async function toggleActive(c: TaxConfiguration) {
        const result = await updateTaxConfigurationAction(c.id, { is_active: !c.is_active })
        if (result.error) { toast.error(result.error); return }
        setConfigurations((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this tax configuration?')) return
        const result = await deleteTaxConfigurationAction(id)
        if (result.error) { toast.error(result.error); return }
        setConfigurations((prev) => prev.filter((c) => c.id !== id))
        toast.success('Tax configuration deleted')
    }

    return (
        <div className="space-y-4">
            <Card>
                <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-3">Registered Business Tax Info</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                    <div>
                        <p className="text-ink-subtle text-xs">PAN Number</p>
                        <p className="font-bold text-ink">{restaurantTax.pan_number || '—'}</p>
                    </div>
                    <div>
                        <p className="text-ink-subtle text-xs">VAT Registered</p>
                        <p className="font-bold text-ink">{restaurantTax.vat_registered ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                        <p className="text-ink-subtle text-xs">VAT Number</p>
                        <p className="font-bold text-ink">{restaurantTax.vat_number || '—'}</p>
                    </div>
                </div>
                <p className="text-[11px] text-ink-subtle mt-3">Managed from Company Settings — shown here read-only.</p>
            </Card>

            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Tax Configuration</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (c) => <span className="font-bold text-ink">{c.name}</span> },
                    { key: 'tax_type', header: 'Type', render: (c) => c.tax_type.toUpperCase() },
                    { key: 'rate_percent', header: 'Rate', align: 'right', render: (c) => (c.rate_percent != null ? `${c.rate_percent}%` : '—') },
                    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.is_active ? 'active' : 'closed'} label={c.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={configurations}
                rowKey={(c) => c.id}
                searchKeys={(c) => [c.name]}
                emptyIcon={Percent}
                emptyTitle="No tax configurations yet"
                renderActions={(c) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(c.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Tax Configuration" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Standard VAT" />
                <FormSelect label="Type" required value={form.tax_type} onChange={(e) => setForm((f) => ({ ...f, tax_type: e.target.value as TaxType }))}>
                    <option value="vat">VAT</option>
                    <option value="pan">PAN</option>
                    <option value="other">Other</option>
                </FormSelect>
                <FormInput label="Rate (%)" type="number" min="0" step="0.01" value={form.rate_percent} onChange={(e) => setForm((f) => ({ ...f, rate_percent: e.target.value }))} />
            </FormModal>
        </div>
    )
}

interface ExpandedSummary {
    vatRegistered: boolean
    totalSales: number
    taxableSales: number
    outputVat: number
    totalPurchases: number
    taxablePurchases: number
    inputVat: number
    netVat: number
}

function FilingsTab({
    configurations,
    filings,
    setFilings,
    restaurantTax,
}: {
    configurations: TaxConfiguration[]
    filings: any[]
    setFilings: (fn: (prev: any[]) => any[]) => void
    restaurantTax: { vat_registered: boolean }
}) {
    if (!restaurantTax.vat_registered) {
        return (
            <div className="border border-hairline rounded-3xl p-8 text-center space-y-3 bg-surface-muted/30">
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto animate-pulse" />
                <h3 className="font-extrabold text-sm text-ink">VAT Returns Locked</h3>
                <p className="text-xs text-ink-subtle max-w-sm mx-auto">
                    VAT filing summary panels and IRD return estimators are only available for VAT registered hotels and restaurants.
                </p>
                <p className="text-[11px] text-ink-subtle mt-2">
                    Operating mode: **PAN Standalone**. You can configure your VAT registration status under settings.
                </p>
            </div>
        )
    }

    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ tax_configuration_id: '', period_start: '', period_end: '', ird_reference: '', notes: '' })

    // Expanded filing state for dynamic audit reporting
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [summaries, setSummaries] = useState<Record<string, ExpandedSummary>>({})
    const [loadingSummary, setLoadingSummary] = useState<string | null>(null)

    // Live return preview calculations
    const [previewData, setPreviewData] = useState<ExpandedSummary | null>(null)
    const [loadingPreview, setLoadingPreview] = useState(false)

    // Load preview when date range changes in form
    useEffect(() => {
        if (form.period_start && form.period_end && form.period_end >= form.period_start) {
            const loadPreview = async () => {
                setLoadingPreview(true)
                const res = await calculateVatFilingSummaryAction(form.period_start, form.period_end)
                setLoadingPreview(false)
                if (res.data) {
                    setPreviewData(res.data)
                } else {
                    setPreviewData(null)
                }
            }
            loadPreview()
        } else {
            setPreviewData(null)
        }
    }, [form.period_start, form.period_end])

    const handleRowExpand = async (id: string, start: string, end: string) => {
        if (expandedId === id) {
            setExpandedId(null)
            return
        }
        setExpandedId(id)
        if (summaries[id]) return

        setLoadingSummary(id)
        try {
            const res = await calculateVatFilingSummaryAction(start, end)
            if (res.data) {
                setSummaries(prev => ({ ...prev, [id]: res.data }))
            } else if (res.error) {
                toast.error(res.error)
            }
        } catch {
            toast.error('Failed to load filing summary statistics')
        } finally {
            setLoadingSummary(null)
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createTaxFilingAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => [result.data as any, ...prev])
        toast.success('Tax filing recorded successfully')
        setOpen(false)
        setForm({ tax_configuration_id: '', period_start: '', period_end: '', ird_reference: '', notes: '' })
        setPreviewData(null)
    }

    async function markFiled(id: string) {
        const result = await markTaxFilingFiledAction(id)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'filed' } : f)))
        toast.success('Filing marked as filed')
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this filing?')) return
        const result = await deleteTaxFilingAction(id)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => prev.filter((f) => f.id !== id))
        toast.success('Filing deleted')
    }

    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={configurations.length === 0}>
                    New Tax Return Filing
                </Button>
            </div>

            {filings.length === 0 ? (
                <div className="border border-hairline rounded-3xl p-12 text-center space-y-3 bg-surface-muted/30">
                    <FileText className="w-12 h-12 text-ink-subtle/50 mx-auto" />
                    <h3 className="font-extrabold text-sm text-ink">No Tax Filings Recorded</h3>
                    <p className="text-xs text-ink-subtle max-w-sm mx-auto">
                        Record and audit your VAT/PAN filing periods, view sales vs purchase VAT declarations, and keep track of IRD references.
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filings.map((filing) => {
                        const isExpanded = expandedId === filing.id
                        const summary = summaries[filing.id]
                        const isFilingLoading = loadingSummary === filing.id

                        return (
                            <div 
                                key={filing.id} 
                                className="border border-hairline bg-surface rounded-3xl overflow-hidden transition-all duration-200"
                            >
                                {/* Header Summary Row */}
                                <div 
                                    onClick={() => handleRowExpand(filing.id, filing.period_start, filing.period_end)}
                                    className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:bg-surface-muted/20 transition"
                                >
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-extrabold text-sm text-ink">
                                                {filing.tax_configurations?.name || 'Standard VAT'}
                                            </span>
                                            <StatusBadge 
                                                status={filing.status} 
                                                label={filing.status === 'filed' ? 'Filed' : 'Draft'} 
                                            />
                                        </div>
                                        <p className="text-xs text-ink-subtle font-semibold">
                                            Period: {new Date(filing.period_start).toLocaleDateString()} to {new Date(filing.period_end).toLocaleDateString()}
                                        </p>
                                    </div>

                                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                                        <div className="text-right">
                                            <span className="block text-[10px] text-ink-subtle font-bold uppercase">IRD Ref Reference</span>
                                            <span className="text-xs font-bold text-ink">{filing.ird_reference || '—'}</span>
                                        </div>
                                        {isExpanded ? <ChevronUp className="w-4 h-4 text-ink-subtle" /> : <ChevronDown className="w-4 h-4 text-ink-subtle" />}
                                    </div>
                                </div>

                                {/* Expanded Audit Details Panel */}
                                {isExpanded && (
                                    <div className="border-t border-hairline bg-surface-muted/10 p-5 space-y-4">
                                        {isFilingLoading ? (
                                            <div className="flex items-center justify-center py-8 gap-2 text-xs font-bold text-ink-subtle">
                                                <Loader2 className="w-4 h-4 animate-spin text-[#ff5a00]" />
                                                <span>Calculating returns and totals...</span>
                                            </div>
                                        ) : summary ? (
                                            <div className="space-y-4">
                                                {/* Audit Grid */}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                    {/* Sales */}
                                                    <div className="p-4 bg-surface border border-hairline rounded-2xl space-y-2">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Sales Revenue (Output)</span>
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-xs font-bold text-ink-subtle">Total Gross:</span>
                                                            <span className="text-sm font-bold text-ink">{fmt(summary.totalSales)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-baseline border-t border-hairline pt-1 text-xs">
                                                            <span className="text-ink-subtle font-medium">Output VAT (13%):</span>
                                                            <span className="font-extrabold text-rose-600">+{fmt(summary.outputVat)}</span>
                                                        </div>
                                                    </div>

                                                    {/* Purchases */}
                                                    <div className="p-4 bg-surface border border-hairline rounded-2xl space-y-2">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Supplier Purchases (Input)</span>
                                                        <div className="flex justify-between items-baseline">
                                                            <span className="text-xs font-bold text-ink-subtle">Total Gross:</span>
                                                            <span className="text-sm font-bold text-ink">{fmt(summary.totalPurchases)}</span>
                                                        </div>
                                                        <div className="flex justify-between items-baseline border-t border-hairline pt-1 text-xs">
                                                            <span className="text-ink-subtle font-medium">Input VAT (13%):</span>
                                                            <span className="font-extrabold text-emerald-600">-{fmt(summary.inputVat)}</span>
                                                        </div>
                                                    </div>

                                                    {/* Net Payable / Refund */}
                                                    <div className="p-4 bg-surface border border-hairline rounded-2xl space-y-2 flex flex-col justify-between">
                                                        <div>
                                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Net Return Calculation</span>
                                                            <p className={`text-xl font-black mt-2 ${summary.netVat >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                {fmt(Math.abs(summary.netVat))}
                                                            </p>
                                                        </div>
                                                        <div className="pt-2 border-t border-hairline flex items-center justify-between">
                                                            <span className="text-[10px] font-bold uppercase text-ink-subtle">Filing Return:</span>
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                                summary.netVat >= 0 ? 'bg-rose-50 text-rose-700 border border-rose-100' : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                            }`}>
                                                                {summary.netVat >= 0 ? 'Payable to Government' : 'Tax Refund Claim'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {filing.notes && (
                                                    <p className="text-xs text-ink-subtle bg-surface p-3 border border-hairline rounded-xl">
                                                        <strong>Filing Notes:</strong> {filing.notes}
                                                    </p>
                                                )}

                                                {/* Actions */}
                                                <div className="flex justify-between items-center border-t border-hairline pt-4 text-xs font-bold">
                                                    <span className="text-ink-subtle">
                                                        {filing.status === 'filed' && filing.filed_at && (
                                                            <span>Filed on {new Date(filing.filed_at).toLocaleDateString()}</span>
                                                        )}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleDelete(filing.id)}
                                                            className="p-1.5 text-ink-subtle hover:text-rose-600 border border-hairline hover:border-rose-100 bg-surface rounded-xl transition"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                        {filing.status === 'draft' && (
                                                            <button
                                                                onClick={() => markFiled(filing.id)}
                                                                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                                                            >
                                                                <CheckCircle size={12} />
                                                                Submit & Mark Filed
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-ink-subtle py-4 text-center">Filing details could not be retrieved.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Creation Dialog */}
            <FormModal open={open} onClose={() => setOpen(false)} title="New Tax Return Filing" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Tax Configuration" required value={form.tax_configuration_id} onChange={(e) => setForm((f) => ({ ...f, tax_configuration_id: e.target.value }))}>
                    <option value="">Select a tax configuration</option>
                    {configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
                <FormInput label="Period Start" type="date" required value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} />
                <FormInput label="Period End" type="date" required value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} />
                <FormInput label="IRD Reference (optional)" value={form.ird_reference} onChange={(e) => setForm((f) => ({ ...f, ird_reference: e.target.value }))} placeholder="e.g. IRD-VAT-2026-Q1" />
                <FormInput label="Notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Additional filing comments..." />

                {/* Return preview loading state */}
                {loadingPreview && (
                    <div className="p-4 bg-gray-50 border border-hairline rounded-2xl flex items-center justify-center gap-1.5 text-xs text-ink-subtle font-bold">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff5a00]" />
                        <span>Calculating taxable sales, purchases & net return preview...</span>
                    </div>
                )}

                {/* Return preview card (Nepalese inclusive tax regulations compliant) */}
                {!loadingPreview && previewData && (
                    <div className="p-4 bg-amber-50/20 border border-amber-100 rounded-2xl space-y-3">
                        <div className="flex items-center gap-1.5 text-xs font-black text-amber-800">
                            <Calculator size={14} />
                            <span>IRD Return Estimation Preview</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs font-bold">
                            <div className="bg-surface p-2.5 rounded-xl border border-hairline">
                                <span className="text-[9px] text-ink-subtle uppercase tracking-wider block">Taxable Sales</span>
                                <span className="text-ink">{fmt(previewData.taxableSales)}</span>
                                <span className="block text-[10px] text-rose-600 mt-0.5">VAT: +{fmt(previewData.outputVat)}</span>
                            </div>
                            <div className="bg-surface p-2.5 rounded-xl border border-hairline">
                                <span className="text-[9px] text-ink-subtle uppercase tracking-wider block">Taxable Purchases</span>
                                <span className="text-ink">{fmt(previewData.taxablePurchases)}</span>
                                <span className="block text-[10px] text-emerald-600 mt-0.5">VAT: -{fmt(previewData.inputVat)}</span>
                            </div>
                        </div>
                        <div className="bg-surface p-3 border border-hairline rounded-xl flex items-center justify-between text-xs font-bold">
                            <span className="text-ink-subtle">Estimated Net VAT Return:</span>
                            <span className={previewData.netVat >= 0 ? 'text-rose-600' : 'text-emerald-600'}>
                                {fmt(Math.abs(previewData.netVat))} ({previewData.netVat >= 0 ? 'Payable' : 'Refund'})
                            </span>
                        </div>
                    </div>
                )}
            </FormModal>
        </div>
    )
}

function IrdSyncLogsTab({
    initialLogs,
    restaurantTax,
}: {
    initialLogs: any[]
    restaurantTax: { vat_registered: boolean }
}) {
    const [logs, setLogs] = useState(initialLogs)
    const [retryingId, setRetryingId] = useState<string | null>(null)

    if (!restaurantTax.vat_registered) {
        return (
            <div className="border border-hairline rounded-3xl p-8 text-center space-y-3 bg-surface-muted/30">
                <AlertCircle className="w-12 h-12 text-amber-500 mx-auto animate-pulse" />
                <h3 className="font-extrabold text-sm text-ink">Sync Logs Locked</h3>
                <p className="text-xs text-ink-subtle max-w-sm mx-auto">
                    Inland Revenue Department (IRD) billing transmission logs are only generated for VAT registered properties.
                </p>
            </div>
        )
    }

    const handleRetry = async (id: string) => {
        setRetryingId(id)
        try {
            const res = await retryIrdSyncAction(id)
            setRetryingId(null)
            if (res.success) {
                toast.success('Invoice synchronized successfully!')
                const refreshRes = await getIrdSyncLogsAction()
                if (refreshRes.data) {
                    setLogs(refreshRes.data)
                }
            } else if (res.error) {
                toast.error(res.error)
            } else {
                toast.error(res.response || 'Sync failed')
            }
        } catch {
            toast.error('An unexpected error occurred during sync retry')
            setRetryingId(null)
        }
    }

    return (
        <div className="space-y-4">
            <DataTable
                columns={[
                    { key: 'invoice_number', header: 'Invoice Number', render: (l) => <span className="font-bold text-ink">{l.invoice_number}</span> },
                    { key: 'total_amount', header: 'Total Amount', align: 'right', render: (l) => fmt(Number(l.total_amount)) },
                    { key: 'tax_vat', header: 'Taxable / VAT', render: (l) => (
                        <span className="text-xs text-ink-subtle font-semibold">
                            Taxable: {fmt(Number(l.taxable_amount))} | VAT: {fmt(Number(l.vat_amount))}
                        </span>
                    ) },
                    { key: 'sync_status', header: 'Sync Status', render: (l) => (
                        <StatusBadge 
                            status={l.sync_status === 'synced' ? 'active' : 'closed'} 
                            label={l.sync_status.toUpperCase()} 
                        />
                    ) },
                    { key: 'synced_at', header: 'Synced At', render: (l) => l.synced_at ? new Date(l.synced_at).toLocaleString() : '—' },
                    { key: 'response', header: 'CBMS Gateway Response', render: (l) => (
                        <span className="text-xs text-ink-subtle max-w-[250px] truncate block" title={l.sync_response}>
                            {l.sync_response || 'Pending response...'}
                        </span>
                    ) },
                ]}
                rows={logs}
                rowKey={(l) => l.id}
                searchKeys={(l) => [l.invoice_number, l.sync_status]}
                emptyIcon={FileText}
                emptyTitle="No IRD transmission logs yet"
                emptyDescription="Live invoice transmissions to the Nepal CBMS server will be logged here."
                renderActions={(l) => (
                    <div className="flex items-center justify-end gap-1.5">
                        {l.sync_status !== 'synced' && (
                            <Button 
                                size="sm" 
                                variant="ghost" 
                                disabled={retryingId === l.id} 
                                onClick={() => handleRetry(l.id)}
                            >
                                {retryingId === l.id ? 'Retrying...' : 'Retry Sync'}
                            </Button>
                        )}
                    </div>
                )}
            />
        </div>
    )
}
