'use client'

import { useState } from 'react'
import { Plus, Trash2, Banknote } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, FormTextarea, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import type { Loan, LoanEmiSchedule, LoanPayment } from '@/types/database'
import {
    createLoanAction, updateLoanStatusAction, deleteLoanAction,
    createLoanEmiAction, updateLoanEmiStatusAction, deleteLoanEmiAction,
    createLoanPaymentAction, deleteLoanPaymentAction,
} from './actions'
import { useConfirmStore } from '@/lib/stores/confirm'

export default function LoansManager({
    initialLoans,
    initialEmiSchedule,
    initialPayments,
}: {
    initialLoans: Loan[]
    initialEmiSchedule: LoanEmiSchedule[]
    initialPayments: LoanPayment[]
}) {
    const { confirm } = useConfirmStore()
    const [tab, setTab] = useState('loans')
    const [loans, setLoans] = useState(initialLoans)
    const [emiSchedule, setEmiSchedule] = useState(initialEmiSchedule)
    const [payments, setPayments] = useState(initialPayments)

    const tabs: SectionTab[] = [
        { key: 'loans', label: 'Loan Accounts', count: loans.length },
        { key: 'emi', label: 'EMI Schedule', count: emiSchedule.length },
        { key: 'payments', label: 'Payments & Interest', count: payments.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'loans' && <LoansTab loans={loans} setLoans={setLoans} />}
            {tab === 'emi' && <EmiTab loans={loans} emiSchedule={emiSchedule} setEmiSchedule={setEmiSchedule} />}
            {tab === 'payments' && <PaymentsTab loans={loans} payments={payments} setPayments={setPayments} />}
        </div>
    )
}

function LoansTab({ loans, setLoans }: { loans: Loan[]; setLoans: (fn: (prev: Loan[]) => Loan[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ lender_name: '', principal_amount: '', interest_rate: '', start_date: '', tenure_months: '', notes: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createLoanAction({
            lender_name: form.lender_name,
            principal_amount: parseFloat(form.principal_amount) || 0,
            interest_rate: form.interest_rate ? parseFloat(form.interest_rate) : undefined,
            start_date: form.start_date,
            tenure_months: form.tenure_months ? parseInt(form.tenure_months, 10) : undefined,
            notes: form.notes,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setLoans((prev) => [result.data as Loan, ...prev])
        toast.success('Loan account created')
        setOpen(false)
        setForm({ lender_name: '', principal_amount: '', interest_rate: '', start_date: '', tenure_months: '', notes: '' })
    }

    async function toggleStatus(loan: Loan) {
        const next = loan.status === 'active' ? 'closed' : 'active'
        const result = await updateLoanStatusAction(loan.id, next)
        if (result.error) { toast.error(result.error); return }
        setLoans((prev) => prev.map((l) => (l.id === loan.id ? { ...l, status: next } : l)))
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this loan account?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteLoanAction(id)
        if (result.error) { toast.error(result.error); return }
        setLoans((prev) => prev.filter((l) => l.id !== id))
        toast.success('Loan account deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Loan</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'lender_name', header: 'Lender', render: (l) => <span className="font-bold text-ink">{l.lender_name}</span> },
                    { key: 'principal_amount', header: 'Principal', align: 'right', render: (l) => formatCurrency(l.principal_amount), sortValue: (l) => l.principal_amount },
                    { key: 'interest_rate', header: 'Interest Rate', align: 'right', render: (l) => (l.interest_rate != null ? `${l.interest_rate}%` : '—') },
                    { key: 'start_date', header: 'Start Date', render: (l) => new Date(l.start_date).toLocaleDateString() },
                    { key: 'tenure_months', header: 'Tenure', render: (l) => (l.tenure_months ? `${l.tenure_months} mo` : '—') },
                    { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status === 'active' ? 'active' : 'closed'} /> },
                ]}
                rows={loans}
                rowKey={(l) => l.id}
                searchKeys={(l) => [l.lender_name]}
                emptyIcon={Banknote}
                emptyTitle="No loans yet"
                emptyDescription="Track loans received from lenders."
                renderActions={(l) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleStatus(l)}>{l.status === 'active' ? 'Close' : 'Reopen'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(l.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Loan Account" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Lender Name" required value={form.lender_name} onChange={(e) => setForm((f) => ({ ...f, lender_name: e.target.value }))} />
                <FormInput label="Principal Amount" type="number" min="0.01" step="0.01" required value={form.principal_amount} onChange={(e) => setForm((f) => ({ ...f, principal_amount: e.target.value }))} />
                <FormInput label="Interest Rate (%)" type="number" min="0" step="0.01" value={form.interest_rate} onChange={(e) => setForm((f) => ({ ...f, interest_rate: e.target.value }))} />
                <FormInput label="Start Date" type="date" required value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
                <FormInput label="Tenure (months)" type="number" min="1" value={form.tenure_months} onChange={(e) => setForm((f) => ({ ...f, tenure_months: e.target.value }))} />
                <FormTextarea label="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function EmiTab({ loans, emiSchedule, setEmiSchedule }: { loans: Loan[]; emiSchedule: LoanEmiSchedule[]; setEmiSchedule: (fn: (prev: LoanEmiSchedule[]) => LoanEmiSchedule[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ loan_id: '', installment_no: '1', due_date: '', amount: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createLoanEmiAction({
            loan_id: form.loan_id,
            installment_no: parseInt(form.installment_no, 10) || 1,
            due_date: form.due_date,
            amount: parseFloat(form.amount) || 0,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setEmiSchedule((prev) => [result.data as LoanEmiSchedule, ...prev])
        toast.success('Installment added')
        setOpen(false)
        setForm({ loan_id: '', installment_no: '1', due_date: '', amount: '' })
    }

    async function markPaid(id: string) {
        const result = await updateLoanEmiStatusAction(id, 'paid')
        if (result.error) { toast.error(result.error); return }
        setEmiSchedule((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'paid' } : e)))
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this installment?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteLoanEmiAction(id)
        if (result.error) { toast.error(result.error); return }
        setEmiSchedule((prev) => prev.filter((e) => e.id !== id))
        toast.success('Installment deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={loans.length === 0}>New Installment</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'loan', header: 'Loan', render: (e) => e.loans?.lender_name || '—' },
                    { key: 'installment_no', header: '#', render: (e) => e.installment_no, sortValue: (e) => e.installment_no },
                    { key: 'due_date', header: 'Due Date', render: (e) => new Date(e.due_date).toLocaleDateString(), sortValue: (e) => e.due_date },
                    { key: 'amount', header: 'Amount', align: 'right', render: (e) => formatCurrency(e.amount) },
                    { key: 'status', header: 'Status', render: (e) => <StatusBadge status={e.status === 'paid' ? 'paid' : e.status === 'overdue' ? 'rejected' : 'pending'} label={e.status} /> },
                ]}
                rows={emiSchedule}
                rowKey={(e) => e.id}
                emptyIcon={Banknote}
                emptyTitle="No EMI installments scheduled"
                emptyDescription="Add installments to plan out a loan's repayment schedule."
                renderActions={(e) => (
                    <div className="flex items-center justify-end gap-1.5">
                        {e.status !== 'paid' && <Button size="sm" variant="ghost" onClick={() => markPaid(e.id)}>Mark Paid</Button>}
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(e.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New EMI Installment" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Loan" required value={form.loan_id} onChange={(e) => setForm((f) => ({ ...f, loan_id: e.target.value }))}>
                    <option value="">Select a loan</option>
                    {loans.map((l) => <option key={l.id} value={l.id}>{l.lender_name}</option>)}
                </FormSelect>
                <FormInput label="Installment #" type="number" min="1" required value={form.installment_no} onChange={(e) => setForm((f) => ({ ...f, installment_no: e.target.value }))} />
                <FormInput label="Due Date" type="date" required value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function PaymentsTab({ loans, payments, setPayments }: { loans: Loan[]; payments: LoanPayment[]; setPayments: (fn: (prev: LoanPayment[]) => LoanPayment[]) => void }) {
    const { confirm } = useConfirmStore()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ loan_id: '', amount: '', principal_component: '', interest_component: '', payment_date: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createLoanPaymentAction({
            loan_id: form.loan_id,
            amount: parseFloat(form.amount) || 0,
            principal_component: form.principal_component ? parseFloat(form.principal_component) : undefined,
            interest_component: form.interest_component ? parseFloat(form.interest_component) : undefined,
            payment_date: form.payment_date || undefined,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setPayments((prev) => [result.data as LoanPayment, ...prev])
        toast.success('Loan payment recorded')
        setOpen(false)
        setForm({ loan_id: '', amount: '', principal_component: '', interest_component: '', payment_date: '' })
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this payment?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deleteLoanPaymentAction(id)
        if (result.error) { toast.error(result.error); return }
        setPayments((prev) => prev.filter((p) => p.id !== id))
        toast.success('Payment deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={loans.length === 0}>New Payment</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'payment_date', header: 'Date', render: (p) => new Date(p.payment_date).toLocaleDateString(), sortValue: (p) => p.payment_date },
                    { key: 'loan', header: 'Loan', render: (p) => p.loans?.lender_name || '—' },
                    { key: 'principal_component', header: 'Principal', align: 'right', render: (p) => (p.principal_component != null ? formatCurrency(p.principal_component) : '—') },
                    { key: 'interest_component', header: 'Interest', align: 'right', render: (p) => (p.interest_component != null ? formatCurrency(p.interest_component) : '—') },
                    { key: 'amount', header: 'Total Paid', align: 'right', render: (p) => formatCurrency(p.amount), sortValue: (p) => p.amount },
                    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
                ]}
                rows={payments}
                rowKey={(p) => p.id}
                emptyIcon={Banknote}
                emptyTitle="No loan payments yet"
                emptyDescription="Repayments and interest paid recorded here."
                renderActions={(p) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(p.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Loan Payment" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Loan" required value={form.loan_id} onChange={(e) => setForm((f) => ({ ...f, loan_id: e.target.value }))}>
                    <option value="">Select a loan</option>
                    {loans.map((l) => <option key={l.id} value={l.id}>{l.lender_name}</option>)}
                </FormSelect>
                <FormInput label="Total Amount Paid" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Principal Component" type="number" min="0" step="0.01" hint="Optional breakdown" value={form.principal_component} onChange={(e) => setForm((f) => ({ ...f, principal_component: e.target.value }))} />
                <FormInput label="Interest Component" type="number" min="0" step="0.01" value={form.interest_component} onChange={(e) => setForm((f) => ({ ...f, interest_component: e.target.value }))} />
                <FormInput label="Payment Date" type="date" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
            </FormModal>
        </div>
    )
}
