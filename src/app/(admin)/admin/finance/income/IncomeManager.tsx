'use client'

import { useState } from 'react'
import { Plus, Trash2, TrendingUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, FormTextarea, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import type { IncomeCategory, IncomeEntry } from '@/types/database'
import {
    createIncomeCategoryAction, updateIncomeCategoryAction, deleteIncomeCategoryAction,
    createIncomeEntryAction, deleteIncomeEntryAction,
} from './actions'
import { useConfirmStore } from '@/lib/stores/confirm'

export default function IncomeManager({ initialCategories, initialEntries }: { initialCategories: IncomeCategory[]; initialEntries: IncomeEntry[] }) {
    const { confirm } = useConfirmStore()
    const [tab, setTab] = useState('entries')
    const [categories, setCategories] = useState(initialCategories)
    const [entries, setEntries] = useState(initialEntries)

    const tabs: SectionTab[] = [
        { key: 'entries', label: 'Income Entries & History', count: entries.length },
        { key: 'categories', label: 'Categories', count: categories.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'entries' && <EntriesTab categories={categories} entries={entries} setEntries={setEntries} />}
            {tab === 'categories' && <CategoriesTab categories={categories} setCategories={setCategories} />}
        </div>
    )
}

function CategoriesTab({ categories, setCategories }: { categories: IncomeCategory[]; setCategories: (fn: (prev: IncomeCategory[]) => IncomeCategory[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', description: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createIncomeCategoryAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => [result.data as IncomeCategory, ...prev])
        toast.success('Income category created')
        setOpen(false)
        setForm({ name: '', description: '' })
    }

    async function toggleActive(c: IncomeCategory) {
        const result = await updateIncomeCategoryAction(c.id, { is_active: !c.is_active })
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this category?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteIncomeCategoryAction(id)
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => prev.filter((c) => c.id !== id))
        toast.success('Category deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Category</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (c) => <span className="font-bold text-ink">{c.name}</span> },
                    { key: 'description', header: 'Description', render: (c) => c.description || <span className="text-ink-subtle">—</span> },
                    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.is_active ? 'active' : 'closed'} label={c.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={categories}
                rowKey={(c) => c.id}
                searchKeys={(c) => [c.name]}
                emptyIcon={TrendingUp}
                emptyTitle="No income categories yet"
                emptyDescription="e.g. Interest Income, Service Charge, Other Income."
                renderActions={(c) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(c.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Income Category" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Interest Income" />
                <FormTextarea label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function EntriesTab({
    categories,
    entries,
    setEntries,
}: {
    categories: IncomeCategory[]
    entries: IncomeEntry[]
    setEntries: (fn: (prev: IncomeEntry[]) => IncomeEntry[]) => void
}) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ category_id: '', amount: '', description: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createIncomeEntryAction({ category_id: form.category_id, amount: parseFloat(form.amount) || 0, description: form.description })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setEntries((prev) => [result.data as IncomeEntry, ...prev])
        toast.success('Income entry recorded')
        setOpen(false)
        setForm({ category_id: '', amount: '', description: '' })
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this income entry?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteIncomeEntryAction(id)
        if (result.error) { toast.error(result.error); return }
        setEntries((prev) => prev.filter((e) => e.id !== id))
        toast.success('Income entry deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={categories.length === 0}>New Income Entry</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (e) => new Date(e.created_at).toLocaleString(), sortValue: (e) => e.created_at },
                    { key: 'category', header: 'Category', render: (e) => e.income_categories?.name || '—' },
                    { key: 'description', header: 'Description', render: (e) => e.description },
                    { key: 'amount', header: 'Amount', align: 'right', render: (e) => formatCurrency(e.amount), sortValue: (e) => e.amount },
                    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
                ]}
                rows={entries}
                rowKey={(e) => e.id}
                searchKeys={(e) => [e.description, e.income_categories?.name || '']}
                filters={categories.length ? [{ key: 'category_id', label: 'All categories', options: categories.map((c) => ({ value: c.id, label: c.name })), predicate: (row, value) => row.category_id === value }] : undefined}
                emptyIcon={TrendingUp}
                emptyTitle="No income entries yet"
                emptyDescription="Other income, interest, and service charges recorded here."
                renderActions={(e) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(e.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Income Entry" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Category" required value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">Select a category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}
