'use client'

import { useState } from 'react'
import { Plus, Trash2, HandCoins } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import type { CustomerCreditAccount, ReceivableTransaction, ReceivableTransactionType } from '@/types/database'
import {
    createCustomerCreditAccountAction, updateCustomerCreditAccountAction, deleteCustomerCreditAccountAction,
    createReceivableTransactionAction, deleteReceivableTransactionAction,
} from './actions'

export default function ReceivablesManager({
    initialAccounts,
    initialTransactions,
}: {
    initialAccounts: CustomerCreditAccount[]
    initialTransactions: ReceivableTransaction[]
}) {
    const [tab, setTab] = useState('accounts')
    const [accounts, setAccounts] = useState(initialAccounts)
    const [transactions, setTransactions] = useState(initialTransactions)

    const tabs: SectionTab[] = [
        { key: 'accounts', label: 'Outstanding Customers', count: accounts.length },
        { key: 'transactions', label: 'Charges & Payment Collection', count: transactions.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'accounts' && <AccountsTab accounts={accounts} setAccounts={setAccounts} />}
            {tab === 'transactions' && <TransactionsTab accounts={accounts} transactions={transactions} setTransactions={setTransactions} />}
        </div>
    )
}

function AccountsTab({ accounts, setAccounts }: { accounts: CustomerCreditAccount[]; setAccounts: (fn: (prev: CustomerCreditAccount[]) => CustomerCreditAccount[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ customer_name: '', customer_phone: '', credit_limit: '0' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createCustomerCreditAccountAction({
            customer_name: form.customer_name,
            customer_phone: form.customer_phone,
            credit_limit: parseFloat(form.credit_limit) || 0,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => [result.data as CustomerCreditAccount, ...prev])
        toast.success('Customer credit account created')
        setOpen(false)
        setForm({ customer_name: '', customer_phone: '', credit_limit: '0' })
    }

    async function toggleActive(a: CustomerCreditAccount) {
        const result = await updateCustomerCreditAccountAction(a.id, { is_active: !a.is_active })
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this customer credit account?')) return
        const result = await deleteCustomerCreditAccountAction(id)
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => prev.filter((a) => a.id !== id))
        toast.success('Account deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Customer Account</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'customer_name', header: 'Customer', render: (a) => <span className="font-bold text-ink">{a.customer_name}</span> },
                    { key: 'customer_phone', header: 'Phone', render: (a) => a.customer_phone || <span className="text-ink-subtle">—</span> },
                    { key: 'credit_limit', header: 'Credit Limit', align: 'right', render: (a) => formatCurrency(a.credit_limit), sortValue: (a) => a.credit_limit },
                    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.is_active ? 'active' : 'closed'} label={a.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={accounts}
                rowKey={(a) => a.id}
                searchKeys={(a) => [a.customer_name, a.customer_phone || '']}
                emptyIcon={HandCoins}
                emptyTitle="No customer credit accounts yet"
                emptyDescription="Track customers who carry a running balance."
                renderActions={(a) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(a.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Customer Credit Account" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Customer Name" required value={form.customer_name} onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))} />
                <FormInput label="Phone" value={form.customer_phone} onChange={(e) => setForm((f) => ({ ...f, customer_phone: e.target.value }))} />
                <FormInput label="Credit Limit" type="number" min="0" step="0.01" value={form.credit_limit} onChange={(e) => setForm((f) => ({ ...f, credit_limit: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function TransactionsTab({
    accounts,
    transactions,
    setTransactions,
}: {
    accounts: CustomerCreditAccount[]
    transactions: ReceivableTransaction[]
    setTransactions: (fn: (prev: ReceivableTransaction[]) => ReceivableTransaction[]) => void
}) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ customer_credit_account_id: '', type: 'charge' as ReceivableTransactionType, amount: '', description: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createReceivableTransactionAction({
            customer_credit_account_id: form.customer_credit_account_id,
            type: form.type,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setTransactions((prev) => [result.data as ReceivableTransaction, ...prev])
        toast.success('Transaction recorded')
        setOpen(false)
        setForm({ customer_credit_account_id: '', type: 'charge', amount: '', description: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this transaction?')) return
        const result = await deleteReceivableTransactionAction(id)
        if (result.error) { toast.error(result.error); return }
        setTransactions((prev) => prev.filter((t) => t.id !== id))
        toast.success('Transaction deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={accounts.length === 0}>New Transaction</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (t) => new Date(t.created_at).toLocaleString(), sortValue: (t) => t.created_at },
                    { key: 'customer', header: 'Customer', render: (t) => t.customer_credit_accounts?.customer_name || '—' },
                    { key: 'type', header: 'Type', render: (t) => (t.type === 'charge' ? 'Charge' : 'Payment Collected') },
                    { key: 'description', header: 'Description', render: (t) => t.description },
                    { key: 'amount', header: 'Amount', align: 'right', render: (t) => formatCurrency(t.amount), sortValue: (t) => t.amount },
                    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
                ]}
                rows={transactions}
                rowKey={(t) => t.id}
                searchKeys={(t) => [t.description, t.customer_credit_accounts?.customer_name || '']}
                filters={[{ key: 'type', label: 'All types', options: [{ value: 'charge', label: 'Charge' }, { value: 'payment', label: 'Payment' }], predicate: (row, value) => row.type === value }]}
                emptyIcon={HandCoins}
                emptyTitle="No receivable transactions yet"
                emptyDescription="Charges to customer credit accounts and collected payments appear here."
                renderActions={(t) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(t.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Receivable Transaction" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Customer" required value={form.customer_credit_account_id} onChange={(e) => setForm((f) => ({ ...f, customer_credit_account_id: e.target.value }))}>
                    <option value="">Select a customer</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.customer_name}</option>)}
                </FormSelect>
                <FormSelect label="Type" required value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ReceivableTransactionType }))}>
                    <option value="charge">Charge</option>
                    <option value="payment">Payment Collection</option>
                </FormSelect>
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}
