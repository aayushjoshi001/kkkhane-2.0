'use client'

import { useState } from 'react'
import { Plus, Trash2, ArrowUpRight } from 'lucide-react'
import toast from 'react-hot-toast'
import { DataTable, FormModal, FormInput, FormSelect, FormTextarea, SectionTabs, type SectionTab } from '@/components/finance'
import Button from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import type { Supplier, SupplierBill, SupplierPayment } from '@/types/database'
import {
    createSupplierAction, updateSupplierAction, deleteSupplierAction,
    createSupplierBillAction, deleteSupplierBillAction,
    createSupplierPaymentAction, deleteSupplierPaymentAction,
} from './actions'

export default function PayablesManager({
    initialSuppliers,
    initialBills,
    initialPayments,
}: {
    initialSuppliers: Supplier[]
    initialBills: SupplierBill[]
    initialPayments: SupplierPayment[]
}) {
    const [tab, setTab] = useState('suppliers')
    const formatDate = useDateFormatter()
    const [suppliers, setSuppliers] = useState(initialSuppliers)
    const [bills, setBills] = useState(initialBills)
    const [payments, setPayments] = useState(initialPayments)

    const tabs: SectionTab[] = [
        { key: 'suppliers', label: 'Suppliers', count: suppliers.length },
        { key: 'bills', label: 'Outstanding Bills', count: bills.length },
        { key: 'payments', label: 'Payment History', count: payments.length },
    ]

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} setSuppliers={setSuppliers} />}
            {tab === 'bills' && <BillsTab suppliers={suppliers} bills={bills} setBills={setBills} />}
            {tab === 'payments' && <PaymentsTab suppliers={suppliers} bills={bills} payments={payments} setPayments={setPayments} />}
        </div>
    )
}

function SuppliersTab({ suppliers, setSuppliers }: { suppliers: Supplier[]; setSuppliers: (fn: (prev: Supplier[]) => Supplier[]) => void }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ name: '', contact_person: '', phone: '', email: '', address: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createSupplierAction(form)
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setSuppliers((prev) => [result.data as Supplier, ...prev])
        toast.success('Supplier created')
        setOpen(false)
        setForm({ name: '', contact_person: '', phone: '', email: '', address: '' })
    }

    async function toggleActive(s: Supplier) {
        const result = await updateSupplierAction(s.id, { is_active: !s.is_active })
        if (result.error) { toast.error(result.error); return }
        setSuppliers((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_active: !x.is_active } : x)))
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this supplier?')) return
        const result = await deleteSupplierAction(id)
        if (result.error) { toast.error(result.error); return }
        setSuppliers((prev) => prev.filter((s) => s.id !== id))
        toast.success('Supplier deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)}>New Supplier</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'name', header: 'Name', render: (s) => <span className="font-bold text-ink">{s.name}</span> },
                    { key: 'contact_person', header: 'Contact', render: (s) => s.contact_person || <span className="text-ink-subtle">—</span> },
                    { key: 'phone', header: 'Phone', render: (s) => s.phone || <span className="text-ink-subtle">—</span> },
                    { key: 'email', header: 'Email', render: (s) => s.email || <span className="text-ink-subtle">—</span> },
                    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.is_active ? 'active' : 'closed'} label={s.is_active ? 'Active' : 'Inactive'} /> },
                ]}
                rows={suppliers}
                rowKey={(s) => s.id}
                searchKeys={(s) => [s.name, s.contact_person || '', s.phone || '', s.email || '']}
                emptyIcon={ArrowUpRight}
                emptyTitle="No suppliers yet"
                emptyDescription="Add suppliers to track bills and payments."
                renderActions={(s) => (
                    <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(s)}>{s.is_active ? 'Deactivate' : 'Activate'}</Button>
                        <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(s.id)} />
                    </div>
                )}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Supplier" onSubmit={handleSubmit} submitting={saving}>
                <FormInput label="Name" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                <FormInput label="Contact Person" value={form.contact_person} onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))} />
                <FormInput label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                <FormInput label="Email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                <FormTextarea label="Address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function BillsTab({ suppliers, bills, setBills }: { suppliers: Supplier[]; bills: SupplierBill[]; setBills: (fn: (prev: SupplierBill[]) => SupplierBill[]) => void }) {
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ supplier_id: '', bill_number: '', amount: '', description: '', due_date: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createSupplierBillAction({
            supplier_id: form.supplier_id,
            bill_number: form.bill_number,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
            due_date: form.due_date || undefined,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setBills((prev) => [result.data as SupplierBill, ...prev])
        toast.success('Supplier bill recorded')
        setOpen(false)
        setForm({ supplier_id: '', bill_number: '', amount: '', description: '', due_date: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this bill?')) return
        const result = await deleteSupplierBillAction(id)
        if (result.error) { toast.error(result.error); return }
        setBills((prev) => prev.filter((b) => b.id !== id))
        toast.success('Bill deleted')
    }

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={suppliers.length === 0}>New Bill</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (b) => formatDate(b.created_at), sortValue: (b) => b.created_at },
                    { key: 'supplier', header: 'Supplier', render: (b) => b.suppliers?.name || '—' },
                    { key: 'bill_number', header: 'Bill #', render: (b) => b.bill_number || <span className="text-ink-subtle">—</span> },
                    { key: 'due_date', header: 'Due Date', render: (b) => (b.due_date ? formatDate(b.due_date) : '—') },
                    { key: 'amount', header: 'Amount', align: 'right', render: (b) => formatCurrency(b.amount), sortValue: (b) => b.amount },
                    { key: 'status', header: 'Status', render: (b) => <StatusBadge status={b.status} /> },
                ]}
                rows={bills}
                rowKey={(b) => b.id}
                searchKeys={(b) => [b.bill_number || '', b.suppliers?.name || '']}
                filters={[{ key: 'status', label: 'All statuses', options: [{ value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partial' }, { value: 'paid', label: 'Paid' }], predicate: (row, value) => row.status === value }]}
                emptyIcon={ArrowUpRight}
                emptyTitle="No supplier bills yet"
                emptyDescription="Bills recorded against suppliers appear here."
                renderActions={(b) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(b.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Supplier Bill" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Supplier" required value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}>
                    <option value="">Select a supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </FormSelect>
                <FormInput label="Bill Number" value={form.bill_number} onChange={(e) => setForm((f) => ({ ...f, bill_number: e.target.value }))} />
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Due Date" type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
                <FormInput label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}

function PaymentsTab({
    suppliers,
    bills,
    payments,
    setPayments,
}: {
    suppliers: Supplier[]
    bills: SupplierBill[]
    payments: SupplierPayment[]
    setPayments: (fn: (prev: SupplierPayment[]) => SupplierPayment[]) => void
}) {
    const formatDate = useDateFormatter()
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({ supplier_id: '', bill_id: '', amount: '', description: '' })

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        const result = await createSupplierPaymentAction({
            supplier_id: form.supplier_id,
            bill_id: form.bill_id || undefined,
            amount: parseFloat(form.amount) || 0,
            description: form.description,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        setPayments((prev) => [result.data as SupplierPayment, ...prev])
        toast.success('Supplier payment recorded')
        setOpen(false)
        setForm({ supplier_id: '', bill_id: '', amount: '', description: '' })
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this payment?')) return
        const result = await deleteSupplierPaymentAction(id)
        if (result.error) { toast.error(result.error); return }
        setPayments((prev) => prev.filter((p) => p.id !== id))
        toast.success('Payment deleted')
    }

    const billsForSupplier = bills.filter((b) => b.supplier_id === form.supplier_id)

    return (
        <div className="space-y-3">
            <div className="flex justify-end">
                <Button icon={Plus} size="sm" onClick={() => setOpen(true)} disabled={suppliers.length === 0}>New Payment</Button>
            </div>
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (p) => formatDate(p.created_at), sortValue: (p) => p.created_at },
                    { key: 'supplier', header: 'Supplier', render: (p) => p.suppliers?.name || '—' },
                    { key: 'bill', header: 'Bill #', render: (p) => p.supplier_bills?.bill_number || <span className="text-ink-subtle">—</span> },
                    { key: 'description', header: 'Description', render: (p) => p.description || '—' },
                    { key: 'amount', header: 'Amount', align: 'right', render: (p) => formatCurrency(p.amount), sortValue: (p) => p.amount },
                    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
                ]}
                rows={payments}
                rowKey={(p) => p.id}
                searchKeys={(p) => [p.suppliers?.name || '', p.description || '']}
                emptyIcon={ArrowUpRight}
                emptyTitle="No supplier payments yet"
                emptyDescription="Payments made to suppliers appear here."
                renderActions={(p) => <Button size="sm" variant="ghost" icon={Trash2} onClick={() => handleDelete(p.id)} />}
            />
            <FormModal open={open} onClose={() => setOpen(false)} title="New Supplier Payment" onSubmit={handleSubmit} submitting={saving}>
                <FormSelect label="Supplier" required value={form.supplier_id} onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value, bill_id: '' }))}>
                    <option value="">Select a supplier</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </FormSelect>
                <FormSelect label="Bill (optional)" value={form.bill_id} onChange={(e) => setForm((f) => ({ ...f, bill_id: e.target.value }))}>
                    <option value="">Not linked to a specific bill</option>
                    {billsForSupplier.map((b) => <option key={b.id} value={b.id}>{b.bill_number || formatCurrency(b.amount)}</option>)}
                </FormSelect>
                <FormInput label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <FormInput label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </FormModal>
        </div>
    )
}
