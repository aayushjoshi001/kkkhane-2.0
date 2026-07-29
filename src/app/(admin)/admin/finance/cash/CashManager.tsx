'use client'

import { useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { CashDrawer, CashTransaction, CashCount, CashTransactionType } from '@/types/database'
import {
    createCashDrawerAction, updateCashDrawerAction, deleteCashDrawerAction,
    createCashTransactionAction, deleteCashTransactionAction,
    createCashCountAction, deleteCashCountAction,
} from './actions'
import { useConfirmStore } from '@/lib/stores/confirm'

const TXN_TYPES: { value: CashTransactionType; label: string }[] = [
    { value: 'cash_in', label: 'Cash In' },
    { value: 'cash_out', label: 'Cash Out' },
    { value: 'opening', label: 'Opening Balance' },
    { value: 'closing', label: 'Closing Balance' },
    { value: 'transfer_in', label: 'Transfer In' },
    { value: 'transfer_out', label: 'Transfer Out' },
    { value: 'adjustment', label: 'Adjustment' },
]

export default function CashManager({
    initialDrawers,
    initialTransactions,
    initialCounts,
}: {
    initialDrawers: CashDrawer[]
    initialTransactions: CashTransaction[]
    initialCounts: CashCount[]
}) {
    const { confirm } = useConfirmStore()
    const [tab, setTab] = useState('drawers')
    const formatDate = useDateFormatter()
    const [drawers, setDrawers] = useState(initialDrawers)
    const [transactions, setTransactions] = useState(initialTransactions)
    const [counts, setCounts] = useState(initialCounts)

    const tabs: SectionTab[] = [
        { key: 'drawers', label: 'Cash Drawers', count: drawers.length },
        { key: 'transactions', label: 'Transactions & History', count: transactions.length },
        { key: 'counting', label: 'Counting & Reconciliation', count: counts.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'drawers' && <DrawersTab drawers={drawers} setDrawers={setDrawers} />}
            {tab === 'transactions' && <TransactionsTab drawers={drawers} transactions={transactions} setTransactions={setTransactions} />}
            {tab === 'counting' && <CountingTab drawers={drawers} counts={counts} setCounts={setCounts} />}
        </div>
    )
}

function DrawersTab({ drawers, setDrawers }: { drawers: CashDrawer[]; setDrawers: (fn: (prev: CashDrawer[]) => CashDrawer[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', location: '', opening_balance: '0' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createCashDrawerAction({
            name: form.name,
            location: form.location,
            opening_balance: parseFloat(form.opening_balance) || 0,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setDrawers((prev) => [result.data as CashDrawer, ...prev])
        toast.success('Cash drawer created')
        setOpen(false)
        setForm({ name: '', location: '', opening_balance: '0' })
    }

    async function toggleActive(drawer: CashDrawer) {
        const result = await updateCashDrawerAction(drawer.id, { is_active: !drawer.is_active })
        if (result.error) { toast.error(result.error); return }
        setDrawers((prev) => prev.map((d) => (d.id === drawer.id ? { ...d, is_active: !d.is_active } : d)))
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this cash drawer?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteCashDrawerAction(id)
        if (result.error) { toast.error(result.error); return }
        setDrawers((prev) => prev.filter((d) => d.id !== id))
        toast.success('Cash drawer deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Drawer</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (d) => <span className="font-bold text-ink">{d.name}</span> },
                    { key: 'location', header: 'Location', render: (d) => d.location || <span className="text-ink-subtle">—</span> },
                    { key: 'opening_balance', header: 'Opening Balance', align: 'right', render: (d) => formatCurrency(d.opening_balance), sortValue: (d) => d.opening_balance },
                    { key: 'status', header: 'Status', render: (d) => <StatusBadge status={d.is_active ? 'active' : 'closed'} label={d.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={drawers}
                rowKey={(d) => d.id}
                searchKeys={(d) => [d.name, d.location || '']}
                emptyIcon={Wallet}
                emptyTitle="No cash drawers yet"
                emptyDescription="Create a drawer to start recording cash transactions."
                renderActions={(d) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(d)}>{d.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(d.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Cash Drawer" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Front Counter" />
                <FormInput label="Location" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Optional" />
                <FormInput label="Opening Balance" type="number" min="0" step="0.01" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function TransactionsTab({
    drawers,
    transactions,
    setTransactions,
}: {
    drawers: CashDrawer[]
    transactions: CashTransaction[]
    setTransactions: (fn: (prev: CashTransaction[]) => CashTransaction[]) => void
}) {
    const { confirm } = useConfirmStore()
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ drawer_id: '', type: 'cash_in' as CashTransactionType, amount: '', description: '', counterparty_drawer_id: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createCashTransactionAction({
            drawer_id: form.drawer_id,
            type: form.type,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
            counterparty_drawer_id: form.counterparty_drawer_id || undefined,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setTransactions((prev) => [result.data as CashTransaction, ...prev])
        toast.success('Cash transaction recorded')
        setOpen(false)
        setForm({ drawer_id: '', type: 'cash_in', amount: '', description: '', counterparty_drawer_id: '' })
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this transaction?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteCashTransactionAction(id)
        if (result.error) { toast.error(result.error); return }
        setTransactions((prev) => prev.filter((t) => t.id !== id))
        toast.success('Transaction deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={drawers.length === 0}>New Transaction</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (t) => formatDate(t.created_at), sortValue: (t) => t.created_at },
                    { key: 'drawer', header: 'Drawer', render: (t) => t.cash_drawers?.name || '—' },
                    { key: 'type', header: 'Type', render: (t) => TXN_TYPES.find((x) => x.value === t.type)?.label ?? t.type },
                    { key: 'description', header: 'Description', render: (t) => t.description },
                    { key: 'amount', header: 'Amount', align: 'right', render: (t) => formatCurrency(t.amount), sortValue: (t) => t.amount },
                    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
                ]}
                rows={transactions}
                rowKey={(t) => t.id}
                searchKeys={(t) => [t.description, t.cash_drawers?.name || '']}
                filters={[
                    {
                        key: 'type', label: 'All types',
                        options: TXN_TYPES.map((t) => ({ value: t.value, label: t.label })),
                        predicate: (row, value) => row.type === value,
                    },
                ]}
                emptyIcon={Wallet}
                emptyTitle="No cash transactions yet"
                emptyDescription="Cash In, Cash Out, transfers, and adjustments will appear here."
                renderActions={(t) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(t.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Cash Transaction" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Drawer" required value={form.drawer_id} onChange={(e) => setForm((f) => ({ ...f, drawer_id: e.target.value }))}>
                    <option value="">Select a drawer</option>
                    {drawers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </FormSelect>
                <FormSelect label="Type" required value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as CashTransactionType }))}>
                    {TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </FormSelect>
                {(form.type === 'transfer_in' || form.type === 'transfer_out') && (
                    <FormSelect label="Counterparty Drawer" value={form.counterparty_drawer_id} onChange={(e) => setForm((f) => ({ ...f, counterparty_drawer_id: e.target.value }))}>
                        <option value="">Select a drawer</option>
                        {drawers.filter((d) => d.id !== form.drawer_id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </FormSelect>
                )}
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="What is this for?" />
            </FormModal>
        </div>
    )
}

function CountingTab({
    drawers,
    counts,
    setCounts,
}: {
    drawers: CashDrawer[]
    counts: CashCount[]
    setCounts: (fn: (prev: CashCount[]) => CashCount[]) => void
}) {
    const { confirm } = useConfirmStore()
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ drawer_id: '', counted_total: '', expected_total: '', notes: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createCashCountAction({
            drawer_id: form.drawer_id,
            counted_total: parseFloat(form.counted_total) || 0,
            expected_total: form.expected_total ? parseFloat(form.expected_total) : undefined,
            notes: form.notes,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setCounts((prev) => [result.data as CashCount, ...prev])
        toast.success('Cash count recorded')
        setOpen(false)
        setForm({ drawer_id: '', counted_total: '', expected_total: '', notes: '' })
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this count?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteCashCountAction(id)
        if (result.error) { toast.error(result.error); return }
        setCounts((prev) => prev.filter((c) => c.id !== id))
        toast.success('Cash count deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={drawers.length === 0}>New Count</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (c) => formatDate(c.created_at), sortValue: (c) => c.created_at },
                    { key: 'drawer', header: 'Drawer', render: (c) => c.cash_drawers?.name || '—' },
                    { key: 'counted_total', header: 'Counted', align: 'right', render: (c) => formatCurrency(c.counted_total) },
                    { key: 'expected_total', header: 'Expected', align: 'right', render: (c) => (c.expected_total != null ? formatCurrency(c.expected_total) : '—') },
                    { key: 'variance', header: 'Variance', align: 'right', render: (c) => (c.variance != null ? formatCurrency(c.variance) : '—') },
                    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
                ]}
                rows={counts}
                rowKey={(c) => c.id}
                emptyIcon={Wallet}
                emptyTitle="No cash counts yet"
                emptyDescription="Record a physical count to reconcile a drawer's expected balance."
                renderActions={(c) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(c.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Cash Count" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Drawer" required value={form.drawer_id} onChange={(e) => setForm((f) => ({ ...f, drawer_id: e.target.value }))}>
                    <option value="">Select a drawer</option>
                    {drawers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </FormSelect>
                <FormInput label="Counted Total" type="number" min="0" step="0.01" required value={form.counted_total} onChange={(e) => setForm((f) => ({ ...f, counted_total: e.target.value }))} />
                <FormInput label="Expected Total" type="number" min="0" step="0.01" hint="Optional — leave blank if unknown" value={form.expected_total} onChange={(e) => setForm((f) => ({ ...f, expected_total: e.target.value }))} />
                <FormInput label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </FormModal>
        </div>
    )
}
