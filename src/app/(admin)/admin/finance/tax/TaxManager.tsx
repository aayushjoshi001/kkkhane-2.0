'use client'

import { useState } from 'react'
import { Plus, Trash2, Percent } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import type { TaxConfiguration, TaxFiling, TaxType } from '@/types/database'
import {
    createTaxConfigurationAction, updateTaxConfigurationAction, deleteTaxConfigurationAction,
    createTaxFilingAction, markTaxFilingFiledAction, deleteTaxFilingAction,
} from './actions'

export default function TaxManager({
    initialConfigurations,
    initialFilings,
    restaurantTax,
}: {
    initialConfigurations: TaxConfiguration[]
    initialFilings: TaxFiling[]
    restaurantTax: { pan_number: string | null; vat_registered: boolean; vat_number: string | null }
}) {
    const [tab, setTab] = useState('vat')
    const [configurations, setConfigurations] = useState(initialConfigurations)
    const [filings, setFilings] = useState(initialFilings)

    const tabs: SectionTab[] = [
        { key: 'vat', label: 'VAT & PAN', count: configurations.length },
        { key: 'filings', label: 'Tax Reports, Summary & IRD', count: filings.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'vat' && <VatTab restaurantTax={restaurantTax} configurations={configurations} setConfigurations={setConfigurations} />}
            {tab === 'filings' && <FilingsTab configurations={configurations} filings={filings} setFilings={setFilings} />}
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

function FilingsTab({
    configurations,
    filings,
    setFilings,
}: {
    configurations: TaxConfiguration[]
    filings: TaxFiling[]
    setFilings: (fn: (prev: TaxFiling[]) => TaxFiling[]) => void
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ tax_configuration_id: '', period_start: '', period_end: '', ird_reference: '', notes: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createTaxFilingAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => [result.data as TaxFiling, ...prev])
        toast.success('Tax filing recorded')
        setOpen(false)
        setForm({ tax_configuration_id: '', period_start: '', period_end: '', ird_reference: '', notes: '' })
    }

    async function markFiled(id: string) {
        const result = await markTaxFilingFiledAction(id)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => prev.map((f) => (f.id === id ? { ...f, status: 'filed' } : f)))
        toast.success('Marked as filed')
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this filing?')) return
        const result = await deleteTaxFilingAction(id)
        if (result.error) { toast.error(result.error); return }
        setFilings((prev) => prev.filter((f) => f.id !== id))
        toast.success('Filing deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={configurations.length === 0}>New Filing</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'configuration', header: 'Tax', render: (f) => f.tax_configurations?.name || '—' },
                    { key: 'period', header: 'Period', render: (f) => `${new Date(f.period_start).toLocaleDateString()} – ${new Date(f.period_end).toLocaleDateString()}` },
                    { key: 'ird_reference', header: 'IRD Reference', render: (f) => f.ird_reference || <span className="text-ink-subtle">—</span> },
                    { key: 'status', header: 'Status', render: (f) => <StatusBadge status={f.status} label={f.status === 'filed' ? 'Filed' : 'Draft'} /> },
                ]}
                rows={filings}
                rowKey={(f) => f.id}
                emptyIcon={Percent}
                emptyTitle="No tax filings yet"
                emptyDescription="Track VAT/PAN filing periods and IRD references."
                renderActions={(f) => (
                    <div className="flex items-center justify-end gap-1.5">
                        {f.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => markFiled(f.id)}>Mark Filed</Button>}
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(f.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Tax Filing" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Tax Configuration" required value={form.tax_configuration_id} onChange={(e) => setForm((f) => ({ ...f, tax_configuration_id: e.target.value }))}>
                    <option value="">Select a tax configuration</option>
                    {configurations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
                <FormInput label="Period Start" type="date" required value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} />
                <FormInput label="Period End" type="date" required value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} />
                <FormInput label="IRD Reference" value={form.ird_reference} onChange={(e) => setForm((f) => ({ ...f, ird_reference: e.target.value }))} />
            </FormModal>
        </div>
    )
}
