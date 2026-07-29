'use client'

import { useMemo } from 'react'
import Select from '@/components/ui/Select'
import { NepaliDateInput } from '@/components/ui/NepaliDateInput'

export type SupplierPaymentSource = 'cash' | 'qr' | 'cheque' | 'cash_qr'

export interface SupplierPaymentValue {
    payment_source: SupplierPaymentSource
    bank_name: string
    cash_portion: string
    qr_portion: string
    // Only meaningful when payment_source === 'cheque' — a cheque payment is
    // held pending manager approval server-side, so it never affects a
    // balance until these details are captured and the cheque is approved.
    cheque_written_name: string
    cheque_bank: string
    cheque_number: string
    cheque_date: string
    cheque_type: 'ac_payee' | 'normal'
}

export const EMPTY_SUPPLIER_PAYMENT: SupplierPaymentValue = {
    payment_source: 'cash',
    bank_name: '',
    cash_portion: '',
    qr_portion: '',
    cheque_written_name: '',
    cheque_bank: '',
    cheque_number: '',
    cheque_date: '',
    cheque_type: 'ac_payee',
}

// Used as the bill's vendor_name whenever a purchase is logged with no named
// supplier attached (e.g. bought from an unauthorized/unregistered vendor) —
// lets a manager still track a purchase's total, payment, and any due balance
// purely for their own records, without being forced to register a formal
// supplier first. Purchases under this name are grouped together as "Others"
// in the Suppliers Ledger.
export const UNSPECIFIED_SUPPLIER_NAME = 'Others'

// Sentinel supplier_id for "Others" options in ID-based supplier dropdowns
// (the picker holds a real Supplier's id, not its name). Never a real UUID,
// so it can't collide with an actual supplier's id — resolve it back to
// UNSPECIFIED_SUPPLIER_NAME before billing.
export const OTHERS_SUPPLIER_ID = '__others__'

// Client-side mirror of the server-side check in suppliers/actions.ts, so the
// form can flag a bad split before round-tripping to the server.
export function validateSupplierPayment(value: SupplierPaymentValue, paidAmount: number): string | null {
    if (paidAmount <= 0) return null
    if ((value.payment_source === 'qr' || value.payment_source === 'cheque') && !value.bank_name.trim()) {
        return 'Select a bank account for this payment method.'
    }
    if (value.payment_source === 'cheque') {
        if (!value.cheque_written_name.trim()) return 'Cheque written name is required.'
        if (!value.cheque_bank.trim()) return 'Issuer bank is required.'
        if (!value.cheque_number.trim()) return 'Cheque number is required.'
        if (!value.cheque_date.trim()) return 'Cheque date is required.'
    }
    if (value.payment_source === 'cash_qr') {
        if (!value.bank_name.trim()) return 'Select a bank account for the QR portion.'
        const sum = (parseFloat(value.cash_portion) || 0) + (parseFloat(value.qr_portion) || 0)
        if (Math.abs(sum - paidAmount) > 0.01) return 'Cash + QR amounts must add up to the amount paid.'
    }
    return null
}

// Builds the cheque_details payload the backend actions expect, from this
// component's raw string state.
export function buildChequeDetailsFromSupplierPayment(value: SupplierPaymentValue) {
    return {
        written_name: value.cheque_written_name.trim(),
        bank_cheque: value.cheque_bank.trim(),
        cheque_number: value.cheque_number.trim(),
        cheque_date: value.cheque_date.trim(),
        cheque_type: value.cheque_type,
    }
}

// True when a Cash+QR split leaves part of the bill unpaid — callers should
// confirm with the user before submitting, since a split payment is two
// numbers instead of one and it's easy to leave more on credit than intended
// without noticing.
export function isUnderpaidSplit(value: SupplierPaymentValue, paidAmount: number, totalAmount: number): boolean {
    return value.payment_source === 'cash_qr' && paidAmount < totalAmount - 0.01
}

export function underpaidSplitConfirmMessage(paidAmount: number, totalAmount: number): string {
    const due = totalAmount - paidAmount
    return `You're paying Rs. ${paidAmount.toFixed(2)} of the Rs. ${totalAmount.toFixed(2)} total via Cash + QR. The remaining Rs. ${due.toFixed(2)} will be recorded as due credit to the supplier. Continue?`
}

interface BankAccountOption {
    id: string
    name: string
    account_number?: string | null
}

interface SupplierPaymentFieldsProps {
    value: SupplierPaymentValue
    onChange: (value: SupplierPaymentValue) => void
    bankAccounts: BankAccountOption[]
    paidAmount: number
}

const OPTIONS: { value: SupplierPaymentSource; label: string }[] = [
    { value: 'cash', label: 'Cash' },
    { value: 'qr', label: 'QR' },
    { value: 'cheque', label: 'Cheque' },
    { value: 'cash_qr', label: 'Cash + QR' },
]

// Payment method picker for supplier bills/payments — Cash, QR, Cheque, or a
// Cash+QR split. A split posts as two separate Day Book entries (cash_out +
// bank_out), mirroring the split hotel-booking advance payment pattern, so
// each portion lands in the correct cash-in-hand / bank ledger.
export default function SupplierPaymentFields({ value, onChange, bankAccounts, paidAmount }: SupplierPaymentFieldsProps) {
    const needsBank = value.payment_source === 'qr' || value.payment_source === 'cheque' || value.payment_source === 'cash_qr'

    const splitMismatch = useMemo(() => {
        if (value.payment_source !== 'cash_qr') return false
        const sum = (parseFloat(value.cash_portion) || 0) + (parseFloat(value.qr_portion) || 0)
        return Math.abs(sum - paidAmount) > 0.01
    }, [value.payment_source, value.cash_portion, value.qr_portion, paidAmount])

    return (
        <div className="space-y-3">
            <div>
                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Payment Type</label>
                <div className="grid grid-cols-4 gap-2">
                    {OPTIONS.map(o => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => onChange({ ...value, payment_source: o.value })}
                            className={`py-2 text-[10px] font-black uppercase tracking-wider border rounded-lg transition-all ${
                                value.payment_source === o.value
                                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-sm'
                                    : 'bg-surface border-hairline text-ink-subtle hover:text-ink-subtle'
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
            </div>

            {value.payment_source === 'cash_qr' && (
                <div className="animate-in slide-in-from-top-1 duration-150">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cash Amount (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={value.cash_portion}
                                onChange={e => onChange({ ...value, cash_portion: e.target.value })}
                                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">QR Amount (Rs.)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="0.00"
                                value={value.qr_portion}
                                onChange={e => onChange({ ...value, qr_portion: e.target.value })}
                                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>
                    {splitMismatch && (
                        <p className="text-[10px] font-bold text-rose-500 mt-1.5">
                            Cash + QR must add up to the amount paid (Rs. {paidAmount.toFixed(2)}).
                        </p>
                    )}
                </div>
            )}

            {needsBank && (
                <div className="animate-in slide-in-from-top-1 duration-150">
                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                        {value.payment_source === 'cash_qr' ? 'QR / Bank Account' : 'Bank Account'}
                    </label>
                    <Select
                        value={value.bank_name}
                        onChange={e => onChange({ ...value, bank_name: e.target.value })}
                        required
                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                    >
                        <option value="">Select Bank Account</option>
                        {bankAccounts.map(b => (
                            <option key={b.id} value={b.name}>{b.name}{b.account_number ? ` (${b.account_number})` : ''}</option>
                        ))}
                        {bankAccounts.length === 0 && <option value="General Bank">General Bank</option>}
                    </Select>
                </div>
            )}

            {value.payment_source === 'cheque' && (
                <div className="space-y-3 border-t border-hairline pt-3 animate-in slide-in-from-top-1 duration-150">
                    <p className="text-[10px] font-black text-purple-700 uppercase tracking-wider">
                        Cheque Specifications — held pending manager approval
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Written Name (Given By)</label>
                            <input
                                type="text"
                                value={value.cheque_written_name}
                                onChange={e => onChange({ ...value, cheque_written_name: e.target.value })}
                                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Issuer Bank</label>
                            <input
                                type="text"
                                placeholder="Which bank the cheque is drawn on"
                                value={value.cheque_bank}
                                onChange={e => onChange({ ...value, cheque_bank: e.target.value })}
                                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Number</label>
                            <input
                                type="text"
                                value={value.cheque_number}
                                onChange={e => onChange({ ...value, cheque_number: e.target.value })}
                                className="w-full px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Date</label>
                            <NepaliDateInput
                                aria-label="Cheque date"
                                value={value.cheque_date}
                                onChange={cheque_date => onChange({ ...value, cheque_date })}
                                className="px-3 py-2.5 rounded-xl text-sm font-bold shadow-sm focus:ring-2 focus:ring-brand-500/20"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Type</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => onChange({ ...value, cheque_type: 'ac_payee' })}
                                className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition ${value.cheque_type === 'ac_payee' ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                            >
                                A/C Payee (Company)
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange({ ...value, cheque_type: 'normal' })}
                                className={`py-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition ${value.cheque_type === 'normal' ? 'bg-amber-50 border-amber-500 text-amber-700' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                            >
                                Normal Person Cheque
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
