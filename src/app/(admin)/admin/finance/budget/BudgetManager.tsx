'use client'

import { useState } from 'react'
import { Plus, Trash2, PiggyBank } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { Budget, BudgetCategory, BudgetLine, BudgetPeriodType, BudgetStatus } from '@/types/database'
import {
    createBudgetAction, updateBudgetStatusAction, deleteBudgetAction,
    createBudgetCategoryAction, deleteBudgetCategoryAction,
    createBudgetLineAction, deleteBudgetLineAction,
} from './actions'
import { useConfirmStore } from '@/lib/stores/confirm'

export default function BudgetManager({
    initialBudgets,
    initialCategories,
    initialLines,
}: {
    initialBudgets: Budget[]
    initialCategories: BudgetCategory[]
    initialLines: (BudgetLine & { budgets?: { name: string } })[]
}) {
    const { confirm } = useConfirmStore()
    const [tab, setTab] = useState('budgets')
    const formatDate = useDateFormatter()
    const [budgets, setBudgets] = useState(initialBudgets)
    const [categories, setCategories] = useState(initialCategories)
    const [lines, setLines] = useState(initialLines)

    const tabs: SectionTab[] = [
        { key: 'budgets', label: 'Budget Planning', count: budgets.length },
        { key: 'categories', label: 'Budget Categories', count: categories.length },
        { key: 'lines', label: 'Budget vs Actual & Variance', count: lines.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'budgets' && <BudgetsTab budgets={budgets} setBudgets={setBudgets} />}
            {tab === 'categories' && <CategoriesTab categories={categories} setCategories={setCategories} />}
            {tab === 'lines' && <LinesTab budgets={budgets} categories={categories} lines={lines} setLines={setLines} />}
        </div>
    )
}

function BudgetsTab({ budgets, setBudgets }: { budgets: Budget[]; setBudgets: (fn: (prev: Budget[]) => Budget[]) => void }) {
    const { confirm } = useConfirmStore()
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', period_type: 'monthly' as BudgetPeriodType, start_date: '', end_date: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createBudgetAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setBudgets((prev) => [result.data as Budget, ...prev])
        toast.success('Budget created')
        setOpen(false)
        setForm({ name: '', period_type: 'monthly', start_date: '', end_date: '' })
    }

    async function setStatus(id: string, status: BudgetStatus) {
        const result = await updateBudgetStatusAction(id, status)
        if (result.error) { toast.error(result.error); return }
        setBudgets((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)))
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this budget?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteBudgetAction(id)
        if (result.error) { toast.error(result.error); return }
        setBudgets((prev) => prev.filter((b) => b.id !== id))
        toast.success('Budget deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Budget</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (b) => <span className="font-bold text-ink">{b.name}</span> },
                    { key: 'period_type', header: 'Period', render: (b) => b.period_type },
                    { key: 'range', header: 'Range', render: (b) => `${formatDate(b.start_date)} – ${formatDate(b.end_date)}` },
                    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
                ]}
                rows={budgets}
                rowKey={(b) => b.id}
                searchKeys={(b) => [b.name]}
                emptyIcon={PiggyBank}
                emptyTitle="No budgets yet"
                emptyDescription="Plan a monthly, quarterly, or yearly budget."
                renderActions={(b) => (
                    <div className="flex items-center justify-end gap-1.5">
                        {b.status === 'draft' && <Button size="sm" variant="ghost" onClick={() => setStatus(b.id, 'active')}>Activate</Button>}
                        {b.status === 'active' && <Button size="sm" variant="ghost" onClick={() => setStatus(b.id, 'closed')}>Close</Button>}
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(b.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Budget" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Q1 2026 Operating Budget" />
                <FormSelect label="Period" required value={form.period_type} onChange={(e) => setForm((f) => ({ ...f, period_type: e.target.value as BudgetPeriodType }))}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                </FormSelect>
                <FormInput label="Start Date" type="date" required value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                <FormInput label="End Date" type="date" required value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function CategoriesTab({ categories, setCategories }: { categories: BudgetCategory[]; setCategories: (fn: (prev: BudgetCategory[]) => BudgetCategory[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [name, setName] = useState('')

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createBudgetCategoryAction({ name })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setCategories((prev) => [result.data as BudgetCategory, ...prev])
        toast.success('Budget category created')
        setOpen(false)
        setName('')
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this category?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteBudgetCategoryAction(id)
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
                columns={[{ key: 'name', header: 'Name', render: (c) => <span className="font-bold text-ink">{c.name}</span> }]}
                rows={categories}
                rowKey={(c) => c.id}
                searchKeys={(c) => [c.name]}
                emptyIcon={PiggyBank}
                emptyTitle="No budget categories yet"
                renderActions={(c) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(c.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Budget Category" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
            </FormModal>
        </div>
    )
}

function LinesTab({
    budgets,
    categories,
    lines,
    setLines,
}: {
    budgets: Budget[]
    categories: BudgetCategory[]
    lines: (BudgetLine & { budgets?: { name: string } })[]
    setLines: (fn: (prev: (BudgetLine & { budgets?: { name: string } })[]) => (BudgetLine & { budgets?: { name: string } })[]) => void
}) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ budget_id: '', category_id: '', planned_amount: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createBudgetLineAction({ budget_id: form.budget_id, category_id: form.category_id, planned_amount: parseFloat(form.planned_amount) || 0 })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        const budget = budgets.find((b) => b.id === form.budget_id)
        setLines((prev) => [{ ...(result.data as BudgetLine), budgets: budget ? { name: budget.name } : undefined }, ...prev])
        toast.success('Budget line added')
        setOpen(false)
        setForm({ budget_id: '', category_id: '', planned_amount: '' })
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this budget line?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteBudgetLineAction(id)
        if (result.error) { toast.error(result.error); return }
        setLines((prev) => prev.filter((l) => l.id !== id))
        toast.success('Budget line deleted')
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-subtle">Actual and variance columns populate once the posting engine ties real transactions to budget categories.</p>
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={budgets.length === 0 || categories.length === 0}>New Budget Line</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'budget', header: 'Budget', render: (l) => l.budgets?.name || '—' },
                    { key: 'category', header: 'Category', render: (l) => l.budget_categories?.name || '—' },
                    { key: 'planned_amount', header: 'Planned', align: 'right', render: (l) => formatCurrency(l.planned_amount) },
                    { key: 'actual', header: 'Actual', align: 'right', render: () => <span className="text-ink-subtle">—</span> },
                    { key: 'variance', header: 'Variance', align: 'right', render: () => <span className="text-ink-subtle">—</span> },
                ]}
                rows={lines}
                rowKey={(l) => l.id}
                emptyIcon={PiggyBank}
                emptyTitle="No budget lines yet"
                emptyDescription="Allocate planned amounts per category within a budget."
                renderActions={(l) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(l.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Budget Line" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Budget" required value={form.budget_id} onChange={(e) => setForm((f) => ({ ...f, budget_id: e.target.value }))}>
                    <option value="">Select a budget</option>
                    {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </FormSelect>
                <FormSelect label="Category" required value={form.category_id} onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
                    <option value="">Select a category</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
                <FormInput label="Planned Amount" type="number" min="0" step="0.01" required value={form.planned_amount} onChange={(e) => setForm((f) => ({ ...f, planned_amount: e.target.value }))} />
            </FormModal>
        </div>
    )
}
