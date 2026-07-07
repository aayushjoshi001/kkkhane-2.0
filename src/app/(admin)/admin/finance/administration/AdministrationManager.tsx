'use client'

import { useState } from 'react'
import { Plus, Trash2, Settings2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import type {
    ChartOfAccount, VoucherType, FinancePaymentMethod, ApprovalLevel,
    FiscalYear, AccountingPeriod, FinanceSettings, FinanceRolePermission,
    AccountType, VoucherCategory, FinancePaymentMethodCategory, RoundingMode,
    FinancialEvent,
} from '@/types/database'
import EventsManager from './events/EventsManager'
import {
    createAccountAction, updateAccountAction, deleteAccountAction,
    createVoucherTypeAction, deleteVoucherTypeAction,
    createFinancePaymentMethodAction, deleteFinancePaymentMethodAction,
    createApprovalLevelAction, deleteApprovalLevelAction,
    createFiscalYearAction, setCurrentFiscalYearAction, deleteFiscalYearAction,
    createAccountingPeriodAction, updateAccountingPeriodStatusAction, deleteAccountingPeriodAction,
    updateFinanceSettingsAction,
    setFinanceRolePermissionAction,
} from './actions'

const ROLES = ['Owner', 'Administrator', 'Manager', 'Finance Manager', 'Accountant', 'Cashier', 'Receptionist', 'Staff']
const MODULES = ['dashboard', 'cash', 'bank', 'income', 'expenses', 'receivables', 'payables', 'loans', 'budget', 'tax', 'books', 'statements', 'reports', 'administration', 'audit', 'tools']

export default function AdministrationManager({
    initialAccounts,
    initialVoucherTypes,
    initialPaymentMethods,
    initialApprovalLevels,
    initialFiscalYears,
    initialPeriods,
    initialSettings,
    initialPermissions,
    initialEvents,
    initialEventsTotal,
}: {
    initialAccounts: ChartOfAccount[]
    initialVoucherTypes: VoucherType[]
    initialPaymentMethods: FinancePaymentMethod[]
    initialApprovalLevels: ApprovalLevel[]
    initialFiscalYears: FiscalYear[]
    initialPeriods: AccountingPeriod[]
    initialSettings: FinanceSettings | null
    initialPermissions: FinanceRolePermission[]
    initialEvents: FinancialEvent[]
    initialEventsTotal: number
}) {
    const [tab, setTab] = useState('accounts')
    const [accounts, setAccounts] = useState(initialAccounts)
    const [voucherTypes, setVoucherTypes] = useState(initialVoucherTypes)
    const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods)
    const [approvalLevels, setApprovalLevels] = useState(initialApprovalLevels)
    const [fiscalYears, setFiscalYears] = useState(initialFiscalYears)
    const [periods, setPeriods] = useState(initialPeriods)
    const [permissions, setPermissions] = useState(initialPermissions)

    const tabs: SectionTab[] = [
        { key: 'accounts', label: 'Chart of Accounts', count: accounts.length },
        { key: 'vouchers', label: 'Voucher Types', count: voucherTypes.length },
        { key: 'methods', label: 'Payment Methods', count: paymentMethods.length },
        { key: 'approvals', label: 'Approval Levels', count: approvalLevels.length },
        { key: 'periods', label: 'Fiscal Years & Periods', count: fiscalYears.length },
        { key: 'settings', label: 'Financial Settings' },
        { key: 'permissions', label: 'Role Permissions', count: permissions.length },
        { key: 'events', label: 'Financial Events', count: initialEventsTotal },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'accounts' && <AccountsTab accounts={accounts} setAccounts={setAccounts} />}
            {tab === 'vouchers' && <VoucherTypesTab voucherTypes={voucherTypes} setVoucherTypes={setVoucherTypes} />}
            {tab === 'methods' && <PaymentMethodsTab paymentMethods={paymentMethods} setPaymentMethods={setPaymentMethods} />}
            {tab === 'approvals' && <ApprovalLevelsTab approvalLevels={approvalLevels} setApprovalLevels={setApprovalLevels} />}
            {tab === 'periods' && <PeriodsTab fiscalYears={fiscalYears} setFiscalYears={setFiscalYears} periods={periods} setPeriods={setPeriods} />}
            {tab === 'settings' && <SettingsTab initialSettings={initialSettings} />}
            {tab === 'permissions' && <PermissionsTab permissions={permissions} setPermissions={setPermissions} />}
            {tab === 'events' && <EventsManager initialRows={initialEvents} initialTotal={initialEventsTotal} />}
        </div>
    )
}

function AccountsTab({ accounts, setAccounts }: { accounts: ChartOfAccount[]; setAccounts: (fn: (prev: ChartOfAccount[]) => ChartOfAccount[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ code: '', name: '', account_type: 'asset' as AccountType, parent_id: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createAccountAction({ code: form.code, name: form.name, account_type: form.account_type, parent_id: form.parent_id || undefined })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => [result.data as ChartOfAccount, ...prev])
        toast.success('Account created')
        setOpen(false)
        setForm({ code: '', name: '', account_type: 'asset', parent_id: '' })
    }

    async function toggleActive(a: ChartOfAccount) {
        const result = await updateAccountAction(a.id, { is_active: !a.is_active })
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this account?')) return
        const result = await deleteAccountAction(id)
        if (result.error) { toast.error(result.error); return }
        setAccounts((prev) => prev.filter((a) => a.id !== id))
        toast.success('Account deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Account</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'code', header: 'Code', render: (a) => <span className="font-mono text-xs font-bold">{a.code}</span> },
                    { key: 'name', header: 'Name', render: (a) => <span className="font-bold text-ink">{a.name}</span> },
                    { key: 'account_type', header: 'Type', render: (a) => a.account_type },
                    { key: 'parent', header: 'Parent', render: (a) => accounts.find((x) => x.id === a.parent_id)?.name || <span className="text-ink-subtle">—</span> },
                    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.is_active ? 'active' : 'closed'} label={a.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={accounts}
                rowKey={(a) => a.id}
                searchKeys={(a) => [a.code, a.name]}
                filters={[{ key: 'account_type', label: 'All types', options: ['asset', 'liability', 'equity', 'income', 'expense'].map((t) => ({ value: t, label: t })), predicate: (row, value) => row.account_type === value }]}
                emptyIcon={Settings2}
                emptyTitle="No accounts yet"
                emptyDescription="Build a Chart of Accounts hierarchy for later posting logic."
                renderActions={(a) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(a)}>{a.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(a.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Account" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Code" required value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} placeholder="1000" />
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Cash on Hand" />
                <FormSelect label="Type" required value={form.account_type} onChange={(e) => setForm((f) => ({ ...f, account_type: e.target.value as AccountType }))}>
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="income">Income</option>
                    <option value="expense">Expense</option>
                </FormSelect>
                <FormSelect label="Parent Account" value={form.parent_id} onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}>
                    <option value="">None (top-level)</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                </FormSelect>
            </FormModal>
        </div>
    )
}

function VoucherTypesTab({ voucherTypes, setVoucherTypes }: { voucherTypes: VoucherType[]; setVoucherTypes: (fn: (prev: VoucherType[]) => VoucherType[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', voucher_category: 'receipt' as VoucherCategory, prefix: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createVoucherTypeAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setVoucherTypes((prev) => [result.data as VoucherType, ...prev])
        toast.success('Voucher type created')
        setOpen(false)
        setForm({ name: '', voucher_category: 'receipt', prefix: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this voucher type?')) return
        const result = await deleteVoucherTypeAction(id)
        if (result.error) { toast.error(result.error); return }
        setVoucherTypes((prev) => prev.filter((v) => v.id !== id))
        toast.success('Voucher type deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Voucher Type</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (v) => <span className="font-bold text-ink">{v.name}</span> },
                    { key: 'voucher_category', header: 'Category', render: (v) => v.voucher_category },
                    { key: 'prefix', header: 'Prefix', render: (v) => <span className="font-mono text-xs font-bold">{v.prefix}</span> },
                ]}
                rows={voucherTypes}
                rowKey={(v) => v.id}
                searchKeys={(v) => [v.name, v.prefix]}
                emptyIcon={Settings2}
                emptyTitle="No voucher types yet"
                emptyDescription="e.g. Receipt Voucher (RV), Payment Voucher (PV), Journal Voucher (JV)."
                renderActions={(v) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(v.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Voucher Type" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Receipt Voucher" />
                <FormSelect label="Category" required value={form.voucher_category} onChange={(e) => setForm((f) => ({ ...f, voucher_category: e.target.value as VoucherCategory }))}>
                    <option value="receipt">Receipt</option>
                    <option value="payment">Payment</option>
                    <option value="journal">Journal</option>
                    <option value="contra">Contra</option>
                </FormSelect>
                <FormInput label="Prefix" required value={form.prefix} onChange={(e) => setForm((f) => ({ ...f, prefix: e.target.value }))} placeholder="RV" />
            </FormModal>
        </div>
    )
}

function PaymentMethodsTab({ paymentMethods, setPaymentMethods }: { paymentMethods: FinancePaymentMethod[]; setPaymentMethods: (fn: (prev: FinancePaymentMethod[]) => FinancePaymentMethod[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', category: 'cash' as FinancePaymentMethodCategory })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createFinancePaymentMethodAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setPaymentMethods((prev) => [result.data as FinancePaymentMethod, ...prev])
        toast.success('Payment method created')
        setOpen(false)
        setForm({ name: '', category: 'cash' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this payment method?')) return
        const result = await deleteFinancePaymentMethodAction(id)
        if (result.error) { toast.error(result.error); return }
        setPaymentMethods((prev) => prev.filter((p) => p.id !== id))
        toast.success('Payment method deleted')
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-subtle">Shared source of truth for payment methods — not yet wired into Restaurant/Hotel billing, which use their own fields today.</p>
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Payment Method</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (p) => <span className="font-bold text-ink">{p.name}</span> },
                    { key: 'category', header: 'Category', render: (p) => p.category },
                    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.is_active ? 'active' : 'closed'} label={p.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={paymentMethods}
                rowKey={(p) => p.id}
                searchKeys={(p) => [p.name]}
                emptyIcon={Settings2}
                emptyTitle="No payment methods yet"
                emptyDescription="e.g. Cash, Card, eSewa, Khalti, Fonepay, ConnectIPS, Bank Transfer."
                renderActions={(p) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(p.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Payment Method" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                <FormSelect label="Category" required value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as FinancePaymentMethodCategory }))}>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="wallet">Wallet</option>
                </FormSelect>
            </FormModal>
        </div>
    )
}

function ApprovalLevelsTab({ approvalLevels, setApprovalLevels }: { approvalLevels: ApprovalLevel[]; setApprovalLevels: (fn: (prev: ApprovalLevel[]) => ApprovalLevel[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', level_order: '1', min_amount: '0', max_amount: '', role_required: 'Manager' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createApprovalLevelAction({
            name: form.name,
            level_order: parseInt(form.level_order, 10) || 1,
            min_amount: parseFloat(form.min_amount) || 0,
            max_amount: form.max_amount ? parseFloat(form.max_amount) : undefined,
            role_required: form.role_required,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setApprovalLevels((prev) => [result.data as ApprovalLevel, ...prev])
        toast.success('Approval level created')
        setOpen(false)
        setForm({ name: '', level_order: '1', min_amount: '0', max_amount: '', role_required: 'Manager' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this approval level?')) return
        const result = await deleteApprovalLevelAction(id)
        if (result.error) { toast.error(result.error); return }
        setApprovalLevels((prev) => prev.filter((a) => a.id !== id))
        toast.success('Approval level deleted')
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-subtle">Defines who approves what by amount — not yet enforced on any expense/voucher workflow.</p>
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Approval Level</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'level_order', header: '#', render: (a) => a.level_order, sortValue: (a) => a.level_order },
                    { key: 'name', header: 'Name', render: (a) => <span className="font-bold text-ink">{a.name}</span> },
                    { key: 'range', header: 'Amount Range', align: 'right', render: (a) => `${formatCurrency(a.min_amount)} – ${a.max_amount != null ? formatCurrency(a.max_amount) : '∞'}` },
                    { key: 'role_required', header: 'Role Required', render: (a) => a.role_required },
                ]}
                rows={approvalLevels}
                rowKey={(a) => a.id}
                emptyIcon={Settings2}
                emptyTitle="No approval levels yet"
                renderActions={(a) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(a.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Approval Level" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Level 1 — Manager Approval" />
                <FormInput label="Order" type="number" min="1" required value={form.level_order} onChange={(e) => setForm((f) => ({ ...f, level_order: e.target.value }))} />
                <FormInput label="Min Amount" type="number" min="0" step="0.01" value={form.min_amount} onChange={(e) => setForm((f) => ({ ...f, min_amount: e.target.value }))} />
                <FormInput label="Max Amount" type="number" min="0" step="0.01" hint="Leave blank for no upper limit" value={form.max_amount} onChange={(e) => setForm((f) => ({ ...f, max_amount: e.target.value }))} />
                <FormSelect label="Role Required" required value={form.role_required} onChange={(e) => setForm((f) => ({ ...f, role_required: e.target.value }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </FormSelect>
            </FormModal>
        </div>
    )
}

function PeriodsTab({
    fiscalYears,
    setFiscalYears,
    periods,
    setPeriods,
}: {
    fiscalYears: FiscalYear[]
    setFiscalYears: (fn: (prev: FiscalYear[]) => FiscalYear[]) => void
    periods: AccountingPeriod[]
    setPeriods: (fn: (prev: AccountingPeriod[]) => AccountingPeriod[]) => void
}) {
    const [openYear, setOpenYear] = useState(false)
    const [openPeriod, setOpenPeriod] = useState(false)
    const [saving, setSaving] = useState(false)
    const [yearForm, setYearForm] = useState({ name: '', start_date: '', end_date: '' })
    const [periodForm, setPeriodForm] = useState({ fiscal_year_id: '', name: '', start_date: '', end_date: '' })

    async function handleYearSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createFiscalYearAction(yearForm)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setFiscalYears((prev) => [result.data as FiscalYear, ...prev])
        toast.success('Fiscal year created')
        setOpenYear(false)
        setYearForm({ name: '', start_date: '', end_date: '' })
    }

    async function makeCurrent(id: string) {
        const result = await setCurrentFiscalYearAction(id)
        if (result.error) { toast.error(result.error); return }
        setFiscalYears((prev) => prev.map((y) => ({ ...y, is_current: y.id === id })))
    }

    async function handleYearDelete(id: string) {
        if (!confirm('Delete this fiscal year?')) return
        const result = await deleteFiscalYearAction(id)
        if (result.error) { toast.error(result.error); return }
        setFiscalYears((prev) => prev.filter((y) => y.id !== id))
        toast.success('Fiscal year deleted')
    }

    async function handlePeriodSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createAccountingPeriodAction(periodForm)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setPeriods((prev) => [result.data as AccountingPeriod, ...prev])
        toast.success('Accounting period created')
        setOpenPeriod(false)
        setPeriodForm({ fiscal_year_id: '', name: '', start_date: '', end_date: '' })
    }

    async function togglePeriodStatus(p: AccountingPeriod) {
        const next = p.status === 'open' ? 'closed' : 'open'
        const result = await updateAccountingPeriodStatusAction(p.id, next)
        if (result.error) { toast.error(result.error); return }
        setPeriods((prev) => prev.map((x) => (x.id === p.id ? { ...x, status: next } : x)))
    }

    async function handlePeriodDelete(id: string) {
        if (!confirm('Delete this accounting period?')) return
        const result = await deleteAccountingPeriodAction(id)
        if (result.error) { toast.error(result.error); return }
        setPeriods((prev) => prev.filter((p) => p.id !== id))
        toast.success('Accounting period deleted')
    }

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">Fiscal Years</p>
                    <Button icon={Plus} size="sm" onClick={() => setOpenYear(true)}>New Fiscal Year</Button>
                </div>
                <DataTable
                    columns={[
                        { key: 'name', header: 'Name', render: (y) => <span className="font-bold text-ink">{y.name}</span> },
                        { key: 'range', header: 'Range', render: (y) => `${new Date(y.start_date).toLocaleDateString()} – ${new Date(y.end_date).toLocaleDateString()}` },
                        { key: 'current', header: 'Current', render: (y) => (y.is_current ? <StatusBadge status="active" label="Current" /> : '—') },
                        { key: 'status', header: 'Status', render: (y) => <StatusBadge status={y.status} /> },
                    ]}
                    rows={fiscalYears}
                    rowKey={(y) => y.id}
                    emptyIcon={Settings2}
                    emptyTitle="No fiscal years yet"
                    renderActions={(y) => (
                        <div className="flex items-center justify-end gap-1.5">
                            {!y.is_current && <Button size="sm" variant="ghost" onClick={() => makeCurrent(y.id)}>Set Current</Button>}
                            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleYearDelete(y.id)} />
                        </div>
                    )}
                />
            </div>

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">Accounting Periods</p>
                    <Button icon={Plus} size="sm" onClick={() => setOpenPeriod(true)} disabled={fiscalYears.length === 0}>New Period</Button>
                </div>
                <DataTable
                    columns={[
                        { key: 'fiscal_year', header: 'Fiscal Year', render: (p) => p.fiscal_years?.name || '—' },
                        { key: 'name', header: 'Name', render: (p) => <span className="font-bold text-ink">{p.name}</span> },
                        { key: 'range', header: 'Range', render: (p) => `${new Date(p.start_date).toLocaleDateString()} – ${new Date(p.end_date).toLocaleDateString()}` },
                        { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
                    ]}
                    rows={periods}
                    rowKey={(p) => p.id}
                    emptyIcon={Settings2}
                    emptyTitle="No accounting periods yet"
                    renderActions={(p) => (
                        <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="ghost" onClick={() => togglePeriodStatus(p)}>{p.status === 'open' ? 'Close' : 'Reopen'}</Button>
                            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handlePeriodDelete(p.id)} />
                        </div>
                    )}
                />
            </div>

            <FormModal open={openYear} onClose={() => setOpenYear(false)} title="New Fiscal Year" onSubmit={handleYearSubmit} submitting={saving}>
                <FormInput label="Name" required value={yearForm.name} onChange={(e) => setYearForm((f) => ({ ...f, name: e.target.value }))} placeholder="FY 2082/83" />
                <FormInput label="Start Date" type="date" required value={yearForm.start_date} onChange={(e) => setYearForm((f) => ({ ...f, start_date: e.target.value }))} />
                <FormInput label="End Date" type="date" required value={yearForm.end_date} onChange={(e) => setYearForm((f) => ({ ...f, end_date: e.target.value }))} />
            </FormModal>
            <FormModal open={openPeriod} onClose={() => setOpenPeriod(false)} title="New Accounting Period" onSubmit={handlePeriodSubmit} submitting={saving}>
                <FormSelect label="Fiscal Year" required value={periodForm.fiscal_year_id} onChange={(e) => setPeriodForm((f) => ({ ...f, fiscal_year_id: e.target.value }))}>
                    <option value="">Select a fiscal year</option>
                    {fiscalYears.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
                </FormSelect>
                <FormInput label="Name" required value={periodForm.name} onChange={(e) => setPeriodForm((f) => ({ ...f, name: e.target.value }))} placeholder="Baishakh" />
                <FormInput label="Start Date" type="date" required value={periodForm.start_date} onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))} />
                <FormInput label="End Date" type="date" required value={periodForm.end_date} onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function SettingsTab({ initialSettings }: { initialSettings: FinanceSettings | null }) {
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        base_currency: initialSettings?.base_currency ?? 'NPR',
        default_tax_rate: String(initialSettings?.default_tax_rate ?? 0),
        fiscal_year_start_month: String(initialSettings?.fiscal_year_start_month ?? 1),
        rounding_mode: (initialSettings?.rounding_mode ?? 'nearest') as RoundingMode,
    })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await updateFinanceSettingsAction({
            base_currency: form.base_currency,
            default_tax_rate: parseFloat(form.default_tax_rate) || 0,
            fiscal_year_start_month: parseInt(form.fiscal_year_start_month, 10) || 1,
            rounding_mode: form.rounding_mode,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        toast.success('Financial settings saved')
    }

    return (
        <Card>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
                <FormInput label="Base Currency" required value={form.base_currency} onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value.toUpperCase() }))} placeholder="NPR" />
                <FormInput label="Default Tax Rate (%)" type="number" min="0" step="0.01" value={form.default_tax_rate} onChange={(e) => setForm((f) => ({ ...f, default_tax_rate: e.target.value }))} />
                <FormSelect label="Fiscal Year Start Month" value={form.fiscal_year_start_month} onChange={(e) => setForm((f) => ({ ...f, fiscal_year_start_month: e.target.value }))}>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en', { month: 'long' })}</option>
                    ))}
                </FormSelect>
                <FormSelect label="Rounding Mode" value={form.rounding_mode} onChange={(e) => setForm((f) => ({ ...f, rounding_mode: e.target.value as RoundingMode }))}>
                    <option value="nearest">Nearest</option>
                    <option value="up">Round Up</option>
                    <option value="down">Round Down</option>
                    <option value="none">None</option>
                </FormSelect>
                <Button type="submit" variant="primary" loading={saving}>Save Settings</Button>
            </form>
        </Card>
    )
}

function PermissionsTab({ permissions, setPermissions }: { permissions: FinanceRolePermission[]; setPermissions: (fn: (prev: FinanceRolePermission[]) => FinanceRolePermission[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ role_name: ROLES[0], module: MODULES[0], can_view: true, can_create: false, can_edit: false, can_delete: false, can_approve: false })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await setFinanceRolePermissionAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        const saved = result.data as FinanceRolePermission
        setPermissions((prev) => {
            const existing = prev.findIndex((p) => p.role_name === saved.role_name && p.module === saved.module)
            if (existing >= 0) { const next = [...prev]; next[existing] = saved; return next }
            return [saved, ...prev]
        })
        toast.success('Permission saved')
        setOpen(false)
    }

    return (
        <div className="space-y-3">
            <p className="text-xs text-ink-subtle">Reference matrix only — not enforced on any route or action yet.</p>
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>Set Permission</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'role_name', header: 'Role', render: (p) => <span className="font-bold text-ink">{p.role_name}</span> },
                    { key: 'module', header: 'Module', render: (p) => p.module },
                    { key: 'view', header: 'View', align: 'center', render: (p) => (p.can_view ? '✓' : '—') },
                    { key: 'create', header: 'Create', align: 'center', render: (p) => (p.can_create ? '✓' : '—') },
                    { key: 'edit', header: 'Edit', align: 'center', render: (p) => (p.can_edit ? '✓' : '—') },
                    { key: 'delete', header: 'Delete', align: 'center', render: (p) => (p.can_delete ? '✓' : '—') },
                    { key: 'approve', header: 'Approve', align: 'center', render: (p) => (p.can_approve ? '✓' : '—') },
                ]}
                rows={permissions}
                rowKey={(p) => p.id}
                filters={[{ key: 'role_name', label: 'All roles', options: ROLES.map((r) => ({ value: r, label: r })), predicate: (row, value) => row.role_name === value }]}
                emptyIcon={Settings2}
                emptyTitle="No permissions configured yet"
                emptyDescription="Set what each role can view, create, edit, delete, or approve per module."
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="Set Role Permission" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Role" required value={form.role_name} onChange={(e) => setForm((f) => ({ ...f, role_name: e.target.value }))}>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </FormSelect>
                <FormSelect label="Module" required value={form.module} onChange={(e) => setForm((f) => ({ ...f, module: e.target.value }))}>
                    {MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
                </FormSelect>
                <div className="grid grid-cols-2 gap-2">
                    {(['can_view', 'can_create', 'can_edit', 'can_delete', 'can_approve'] as const).map((key) => (
                        <label key={key} className="flex items-center gap-2 text-sm font-semibold text-ink-muted">
                            <input type="checkbox" checked={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} className="rounded" />
                            {key.replace('can_', '').replace(/^\w/, (c) => c.toUpperCase())}
                        </label>
                    ))}
                </div>
            </FormModal>
        </div>
    )
}
