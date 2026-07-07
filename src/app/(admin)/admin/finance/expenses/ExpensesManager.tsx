'use client'

import { useState } from 'react'
import { Plus, Trash2, Receipt } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, FormTextarea, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import type { Expense, ExpenseCategory, RecurrenceInterval } from '@/types/database'
import {
    createExpenseCategoryAction, updateExpenseCategoryAction, deleteExpenseCategoryAction,
    createExpenseAction, updateExpenseStatusAction, deleteExpenseAction,
} from './actions'

const RECURRENCE: { value: RecurrenceInterval; label: string }[] = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly', label: 'Yearly' },
]

export default function ExpensesManager({ initialCategories, initialExpenses }: { initialCategories: ExpenseCategory[]; initialExpenses: Expense[] }) {
    const [tab, setTab] = useState('expenses')
    const [categories, setCategories] = useState(initialCategories)
    const [expenses, setExpenses] = useState(initialExpenses)

    const tabs: SectionTab[] = [
        { key: 'expenses', label: 'Expense Entry, Approval & History', count: expenses.length },
        { key: 'categories', label: 'Categories', count: categories.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'expenses' && <ExpensesTab categories={categories} expenses={expenses} setExpenses={setExpenses} />}
            {tab === 'categories' && <CategoriesTab categories={categories} setCategories={setCategories} />}
        </div>
    )
}

function CategoriesTab({ categories, setCategories }: { categories: ExpenseCategory[]; setCategories: (fn: (prev: ExpenseCategory[]) => ExpenseCategory[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', description: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createExpenseCategoryAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => [result.data as ExpenseCategory, ...prev])
        toast.success('Expense category created')
        setOpen(false)
        setForm({ name: '', description: '' })
    }

    async function toggleActive(c: ExpenseCategory) {
        const result = await updateExpenseCategoryAction(c.id, { is_active: !c.is_active })
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this category?')) return
        const result = await deleteExpenseCategoryAction(id)
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
                emptyIcon={Receipt}
                emptyTitle="No expense categories yet"
                emptyDescription="e.g. Electricity, Internet, Rent, Marketing, Maintenance."
                renderActions={(c) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(c)}>{c.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(c.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Expense Category" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Electricity" />
                <FormTextarea label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function ExpensesTab({
    categories,
    expenses,
    setExpenses,
}: {
    categories: ExpenseCategory[]
    expenses: Expense[]
    setExpenses: (fn: (prev: Expense[]) => Expense[]) => void
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ category_id: '', amount: '', description: '', vendor_name: '', is_recurring: false, recurrence_interval: 'monthly' as RecurrenceInterval })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createExpenseAction({
            category_id: form.category_id,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
            vendor_name: form.vendor_name,
            is_recurring: form.is_recurring,
            recurrence_interval: form.recurrence_interval,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setExpenses((prev) => [result.data as Expense, ...prev])
        toast.success('Expense recorded')
        setOpen(false)
        setForm({ category_id: '', amount: '', description: '', vendor_name: '', is_recurring: false, recurrence_interval: 'monthly' })
    }

    async function setStatus(id: string, status: 'approved' | 'rejected' | 'paid') {
        const result = await updateExpenseStatusAction(id, status)
        if (result.error) { toast.error(result.error); return }
        setExpenses((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)))
        toast.success(`Expense marked ${status}`)
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this expense?')) return
        const result = await deleteExpenseAction(id)
        if (result.error) { toast.error(result.error); return }
        setExpenses((prev) => prev.filter((e) => e.id !== id))
        toast.success('Expense deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={categories.length === 0}>New Expense</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (e) => new Date(e.created_at).toLocaleString(), sortValue: (e) => e.created_at },
                    { key: 'category', header: 'Category', render: (e) => e.expense_categories?.name || '—' },
                    { key: 'description', header: 'Description', render: (e) => (
                        <div>
                            <p>{e.description}</p>
                            {e.is_recurring && <span className="text-[10px] font-bold text-brand-600 uppercase">Recurring · {e.recurrence_interval}</span>}
                        </div>
                    ) },
                    { key: 'vendor_name', header: 'Vendor', render: (e) => e.vendor_name || <span className="text-ink-subtle">—</span> },
                    { key: 'amount', header: 'Amount', align: 'right', render: (e) => formatCurrency(e.amount), sortValue: (e) => e.amount },
                    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status} /> },
                ]}
                rows={expenses}
                rowKey={(e) => e.id}
                searchKeys={(e) => [e.description, e.vendor_name || '', e.expense_categories?.name || '']}
                filters={[
                    { key: 'status', label: 'All statuses', options: [{ value: 'pending', label: 'Pending' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }, { value: 'paid', label: 'Paid' }], predicate: (row, value) => row.status === value },
                ]}
                emptyIcon={Receipt}
                emptyTitle="No expenses yet"
                emptyDescription="Electricity, internet, rent, and other business expenses recorded here."
                renderActions={(e) => (
                    <div className="flex items-center justify-end gap-1.5">
                        {e.status === 'pending' && (
                            <>
                                <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'approved')}>Approve</Button>
                                <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'rejected')}>Reject</Button>
                            </>
                        )}
                        {e.status === 'approved' && <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'paid')}>Mark Paid</Button>}
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(e.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Expense" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Category" required value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">Select a category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                <FormInput label="Vendor" value={form.vendor_name} onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
                    <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm((f) => ({ ...f, is_recurring: e.target.checked }))} className="rounded" />
                    Recurring expense
                </label>
                {form.is_recurring && (
                    <FormSelect label="Recurrence" value={form.recurrence_interval} onChange={(e) => setForm((f) => ({ ...f, recurrence_interval: e.target.value as RecurrenceInterval }))}>
                        {RECURRENCE.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </FormSelect>
                )}
            </FormModal>
        </div>
    )
}
