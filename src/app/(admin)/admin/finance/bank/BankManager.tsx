'use client'

import { useState } from 'react'
import { Landmark, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { BankAccount, BankTransaction, BankReconciliation, BankAccountType, WalletProvider, BankTransactionType } from '@/types/database'
import {
    createBankAccountAction, updateBankAccountAction, deleteBankAccountAction,
    createBankTransactionAction, deleteBankTransactionAction,
    createBankReconciliationAction, deleteBankReconciliationAction,
} from './actions'

const WALLET_PROVIDERS: { value: WalletProvider; label: string }[] = [
    { value: 'esewa', label: 'eSewa' },
    { value: 'khalti', label: 'Khalti' },
    { value: 'fonepay', label: 'Fonepay' },
    { value: 'connectips', label: 'ConnectIPS' },
]

const TXN_TYPES: { value: BankTransactionType; label: string }[] = [
    { value: 'deposit', label: 'Deposit' },
    { value: 'withdrawal', label: 'Withdrawal' },
    { value: 'transfer_in', label: 'Transfer In' },
    { value: 'transfer_out', label: 'Transfer Out' },
]

export default function BankManager({
    initialAccounts,
    initialTransactions,
    initialReconciliations,
}: {
    initialAccounts: BankAccount[]
    initialTransactions: BankTransaction[]
    initialReconciliations: BankReconciliation[]
}) {
    const [tab, setTab] = useState('accounts')
    const formatDate = useDateFormatter()
    const [accounts, setAccounts] = useState(initialAccounts)
    const [transactions, setTransactions] = useState(initialTransactions)
    const [reconciliations, setReconciliations] = useState(initialReconciliations)

    const tabs: SectionTab[] = [
        { key: 'accounts', label: 'Accounts & Wallets', count: accounts.length },
        { key: 'transactions', label: 'Deposits, Withdrawals & Transfers', count: transactions.length },
        { key: 'reconciliation', label: 'Reconciliation & Statement', count: reconciliations.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'accounts' && <AccountsTab accounts={accounts} setAccounts={setAccounts} />}
            {tab === 'transactions' && <TransactionsTab accounts={accounts} transactions={transactions} setTransactions={setTransactions} />}
            {tab === 'reconciliation' && <ReconciliationTab accounts={accounts} reconciliations={reconciliations} setReconciliations={setReconciliations} />}
        </div>
    )
}

function AccountsTab({ accounts, setAccounts }: { accounts: BankAccount[]; setAccounts: (fn: (prev: BankAccount[]) => BankAccount[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', account_type: 'bank' as BankAccountType, wallet_provider: '', bank_name: '', account_number: '', opening_balance: '0', ownership_type: '' as 'company' | 'personal' | '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (form.account_type === 'bank' && !form.ownership_type) {
            toast.error('Please select an Ownership Category for this bank account.')
            return
        }
        setSaving(true)
        const finalBankName = form.account_type === 'bank' 
            ? `${form.ownership_type}:${form.bank_name.trim()}`
            : ''
        const result = await createBankAccountAction({
            name: form.name,
            account_type: form.account_type,
            wallet_provider: form.wallet_provider || undefined,
            bank_name: finalBankName || undefined,
            account_number: form.account_number,
            opening_balance: parseFloat(form.opening_balance) || 0,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => [result.data as BankAccount, ...prev])
        toast.success('Bank account created')
        setOpen(false)
        setForm({ name: '', account_type: 'bank', wallet_provider: '', bank_name: '', account_number: '', opening_balance: '0', ownership_type: '' })
    }

    async function toggleActive(account: BankAccount) {
        const result = await updateBankAccountAction(account.id, { is_active: !account.is_active })
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => prev.map((a) => (a.id === account.id ? { ...a, is_active: !a.is_active } : a)))
    }

    const [deactivateId, setDeactivateId] = useState<string | null>(null)
    const [deactivateReason, setDeactivateReason] = useState('')
    const [deactivating, setDeactivating] = useState(false)

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Account / Wallet</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (a) => <span className="font-bold text-ink">{a.name}</span> },
                    { key: 'type', header: 'Type', render: (a) => {
                        if (a.account_type === 'wallet') {
                            return WALLET_PROVIDERS.find((w) => w.value === a.wallet_provider)?.label ?? 'Wallet'
                        }
                        const bName = a.bank_name || ''
                        if (bName.startsWith('personal:')) {
                            return `Personal Bank (${bName.split('personal:')[1]})`
                        }
                        if (bName.startsWith('company:')) {
                            return `Company Bank (${bName.split('company:')[1]})`
                        }
                        if (bName.startsWith('ac_payee:')) {
                            return `A/C Payee Bank (${bName.split('ac_payee:')[1]})`
                        }
                        return bName || 'Bank'
                    }},
                    { key: 'account_number', header: 'Account No.', render: (a) => a.account_number || <span className="text-ink-subtle">—</span> },
                    { key: 'opening_balance', header: 'Opening Balance', align: 'right', render: (a) => formatCurrency(a.opening_balance), sortValue: (a) => a.opening_balance },
                    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.is_active ? 'active' : 'closed'} label={a.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={accounts}
                rowKey={(a) => a.id}
                searchKeys={(a) => [a.name, a.bank_name || '', a.account_number || '']}
                filters={[{ key: 'account_type', label: 'All types', options: [{ value: 'bank', label: 'Bank' }, { value: 'wallet', label: 'Wallet' }], predicate: (row, value) => row.account_type === value }]}
                emptyIcon={Landmark}
                emptyTitle="No bank accounts or wallets yet"
                emptyDescription="Add a bank account or digital wallet (eSewa, Khalti, Fonepay, ConnectIPS)."
                renderActions={(a) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeactivateId(a.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Bank Account / Wallet" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Nabil Bank — Current A/C" />
                <FormSelect label="Type" required value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value as BankAccountType }))}>
                    <option value="bank">Bank Account</option>
                    <option value="wallet">Digital Wallet</option>
                </FormSelect>
                {form.account_type === 'wallet' ? (
                    <FormSelect label="Wallet Provider" required value={form.wallet_provider} onChange={(e) => setForm((f) => ({ ...f, wallet_provider: e.target.value }))}>
                        <option value="">Select a provider</option>
                        {WALLET_PROVIDERS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                    </FormSelect>
                ) : (
                    <>
                        <FormSelect label="Ownership Category" required value={form.ownership_type} onChange={(e) => setForm((f) => ({ ...f, ownership_type: e.target.value as 'company' | 'personal' | '' }))}>
                            <option value="">Choose Category *</option>
                            <option value="company">Company Account (A/C Payee)</option>
                            <option value="personal">Personal Account (Manager/Owner)</option>
                        </FormSelect>
                        <FormInput label="Bank Name" value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
                        <FormInput label="Account Number" value={form.account_number} onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))} />
                    </>
                )}
                <FormInput label="Opening Balance" type="number" min="0" step="0.01" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} />
            </FormModal>

            <FormModal 
                open={!!deactivateId} 
                onClose={() => { setDeactivateId(null); setDeactivateReason(''); }} 
                title="Delete Bank Account" 
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!deactivateReason.trim()) {
                        toast.error('Please enter a reason/description for deletion.');
                        return;
                    }
                    setDeactivating(true);
                    const result = await deleteBankAccountAction(deactivateId!, deactivateReason);
                    setDeactivating(false);
                    if (result.error) {
                        toast.error(result.error);
                        return;
                    }
                    setAccounts((prev) => prev.map((a) => {
                        if (a.id === deactivateId) {
                            const newBankName = result.updatedBankName || a.bank_name;
                            return { ...a, is_active: false, deactivation_reason: deactivateReason, bank_name: newBankName };
                        }
                        return a;
                    }));
                    toast.success('Bank account deleted and marked as inactive');
                    setDeactivateId(null);
                    setDeactivateReason('');
                }}
                submitting={deactivating}
            >
                <div className="space-y-4">
                    <p className="text-sm text-ink-subtle leading-relaxed">
                        Are you sure you want to delete this bank account? 
                        Historical transactions will remain saved in the system, but no further transactions can be made.
                    </p>
                    <FormInput 
                        label="Reason / Description for Deactivation" 
                        required 
                        value={deactivateReason} 
                        onChange={(e) => setDeactivateReason(e.target.value)} 
                        placeholder="e.g. Account closed at the bank branch / switched to a new QR provider" 
                    />
                </div>
            </FormModal>
        </div>
    )
}

function TransactionsTab({
    accounts,
    transactions,
    setTransactions,
}: {
    accounts: BankAccount[]
    transactions: BankTransaction[]
    setTransactions: (fn: (prev: BankTransaction[]) => BankTransaction[]) => void
}) {
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ bank_account_id: '', type: 'deposit' as BankTransactionType, amount: '', description: '', counterparty_account_id: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createBankTransactionAction({
            bank_account_id: form.bank_account_id,
            type: form.type,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
            counterparty_account_id: form.counterparty_account_id || undefined,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setTransactions((prev) => [result.data as BankTransaction, ...prev])
        toast.success('Bank transaction recorded')
        setOpen(false)
        setForm({ bank_account_id: '', type: 'deposit', amount: '', description: '', counterparty_account_id: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this transaction?')) return
        const result = await deleteBankTransactionAction(id)
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
                    { key: 'created_at', header: 'Date', render: (t) => formatDate(t.created_at), sortValue: (t) => t.created_at },
                    { key: 'account', header: 'Account', render: (t) => t.bank_accounts?.name || '—' },
                    { key: 'type', header: 'Type', render: (t) => TXN_TYPES.find((x) => x.value === t.type)?.label ?? t.type },
                    { key: 'description', header: 'Description', render: (t) => t.description },
                    { key: 'amount', header: 'Amount', align: 'right', render: (t) => formatCurrency(t.amount), sortValue: (t) => t.amount },
                    { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
                ]}
                rows={transactions}
                rowKey={(t) => t.id}
                searchKeys={(t) => [t.description, t.bank_accounts?.name || '']}
                filters={[{ key: 'type', label: 'All types', options: TXN_TYPES.map((t) => ({ value: t.value, label: t.label })), predicate: (row, value) => row.type === value }]}
                emptyIcon={Landmark}
                emptyTitle="No bank transactions yet"
                emptyDescription="Deposits, withdrawals, and transfers will appear here."
                renderActions={(t) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(t.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Bank Transaction" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Account" required value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}>
                    <option value="">Select an account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </FormSelect>
                <FormSelect label="Type" required value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as BankTransactionType }))}>
                    {TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </FormSelect>
                {(form.type === 'transfer_in' || form.type === 'transfer_out') && (
                    <FormSelect label="Counterparty Account" value={form.counterparty_account_id} onChange={(e) => setForm((f) => ({ ...f, counterparty_account_id: e.target.value }))}>
                        <option value="">Select an account</option>
                        {accounts.filter((a) => a.id !== form.bank_account_id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </FormSelect>
                )}
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" required value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function ReconciliationTab({
    accounts,
    reconciliations,
    setReconciliations,
}: {
    accounts: BankAccount[]
    reconciliations: BankReconciliation[]
    setReconciliations: (fn: (prev: BankReconciliation[]) => BankReconciliation[]) => void
}) {
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ bank_account_id: '', statement_date: '', statement_balance: '', book_balance: '', notes: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createBankReconciliationAction({
            bank_account_id: form.bank_account_id,
            statement_date: form.statement_date,
            statement_balance: parseFloat(form.statement_balance) || 0,
            book_balance: form.book_balance ? parseFloat(form.book_balance) : undefined,
            notes: form.notes,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setReconciliations((prev) => [result.data as BankReconciliation, ...prev])
        toast.success('Reconciliation recorded')
        setOpen(false)
        setForm({ bank_account_id: '', statement_date: '', statement_balance: '', book_balance: '', notes: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this reconciliation?')) return
        const result = await deleteBankReconciliationAction(id)
        if (result.error) { toast.error(result.error); return }
        setReconciliations((prev) => prev.filter((r) => r.id !== id))
        toast.success('Reconciliation deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={accounts.length === 0}>New Reconciliation</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'statement_date', header: 'Statement Date', render: (r) => formatDate(r.statement_date), sortValue: (r) => r.statement_date },
                    { key: 'account', header: 'Account', render: (r) => r.bank_accounts?.name || '—' },
                    { key: 'statement_balance', header: 'Statement Balance', align: 'right', render: (r) => formatCurrency(r.statement_balance) },
                    { key: 'book_balance', header: 'Book Balance', align: 'right', render: (r) => (r.book_balance != null ? formatCurrency(r.book_balance) : '—') },
                    { key: 'variance', header: 'Variance', align: 'right', render: (r) => (r.variance != null ? formatCurrency(r.variance) : '—') },
                    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
                ]}
                rows={reconciliations}
                rowKey={(r) => r.id}
                emptyIcon={Landmark}
                emptyTitle="No reconciliations yet"
                emptyDescription="Match a bank statement against book balances."
                renderActions={(r) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(r.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Bank Reconciliation" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Account" required value={form.bank_account_id} onChange={(e) => setForm((f) => ({ ...f, bank_account_id: e.target.value }))}>
                    <option value="">Select an account</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </FormSelect>
                <FormInput label="Statement Date" type="date" required value={form.statement_date} onChange={(e) => setForm((f) => ({ ...f, statement_date: e.target.value }))} />
                <FormInput label="Statement Balance" type="number" step="0.01" required value={form.statement_balance} onChange={(e) => setForm((f) => ({ ...f, statement_balance: e.target.value }))} />
                <FormInput label="Book Balance" type="number" step="0.01" hint="Optional — compared against statement balance" value={form.book_balance} onChange={(e) => setForm((f) => ({ ...f, book_balance: e.target.value }))} />
                <FormInput label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </FormModal>
        </div>
    )
}
