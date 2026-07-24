'use client'

import { useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/utils'
import { useConfirmStore } from '@/lib/stores/confirm'
import { createVoucherAction, openTodayDayBookSessionAction, getSupplierOutstandingBalanceAction, getStaffCurrentDueAction } from '@/app/(admin)/admin/vouchers/actions'
import VoucherPrintSlip, { type VoucherSlipData } from '@/components/admin/VoucherPrintSlip'
import Select from '@/components/ui/Select'

export interface PayPartyResult {
    settledBills?: Array<{ id: string; paid_amount: number }>
}

interface BankAccountOption {
    id: string
    name: string
    bank_name?: string | null
    account_number?: string | null
}

interface PayPartyModalProps {
    isOpen: boolean
    onClose: () => void
    category: 'suppliers' | 'staff'
    partyId: string
    partyName: string
    currentDue?: number
    bankAccounts: BankAccountOption[]
    onSettled: (result: PayPartyResult) => void
}

const STAFF_ENTRY_TYPE_OPTIONS = [
    { value: 'salary_payout' as const, label: 'Salary Payout' },
    { value: 'advance_payment' as const, label: 'Advance Payment' },
    { value: 'bonus' as const, label: 'Bonus' },
]

// The single "Pay" action for a supplier or staff member — really just
// creating a Payment Voucher scoped to that party, so a manager never has
// to record a voucher and settle a ledger balance as two separate actions.
// Used from both Suppliers Ledger and Staff Ledger's header "Pay" button.
export default function PayPartyModal({
    isOpen,
    onClose,
    category,
    partyId,
    partyName,
    currentDue,
    bankAccounts,
    onSettled,
}: PayPartyModalProps) {
    const { confirm } = useConfirmStore()

    const [fetchedDue, setFetchedDue] = useState<number | null>(null)
    const [loadingDue, setLoadingDue] = useState(false)

    useEffect(() => {
        if (currentDue !== undefined) {
            setFetchedDue(currentDue)
            return
        }
        if (!isOpen || !partyId) {
            setFetchedDue(null)
            return
        }
        setLoadingDue(true)
        if (category === 'suppliers') {
            getSupplierOutstandingBalanceAction(partyId)
                .then(res => {
                    if (res.data !== undefined) setFetchedDue(res.data)
                })
                .catch(() => {})
                .finally(() => setLoadingDue(false))
        } else {
            getStaffCurrentDueAction(partyId)
                .then(res => {
                    if (res.data !== undefined) setFetchedDue(res.data)
                })
                .catch(() => {})
                .finally(() => setLoadingDue(false))
        }
    }, [isOpen, partyId, category, currentDue])

    const [amount, setAmount] = useState('')
    const [paymentMode, setPaymentMode] = useState<'cash' | 'qr' | 'cheque'>('cash')
    const [bankName, setBankName] = useState('')
    const [particulars, setParticulars] = useState(`Payment to ${partyName}`)
    const [referenceNo, setReferenceNo] = useState('')
    const [receiverName, setReceiverName] = useState('')
    const [staffEntryType, setStaffEntryType] = useState<'salary_payout' | 'advance_payment' | 'bonus'>('salary_payout')

    const [chequeWrittenName, setChequeWrittenName] = useState('')
    const [chequeBank, setChequeBank] = useState('')
    const [chequeNumber, setChequeNumber] = useState('')
    const [chequeDate, setChequeDate] = useState('')
    const [chequeType, setChequeType] = useState<'ac_payee' | 'normal'>('ac_payee')

    const [saving, setSaving] = useState(false)
    const [openingSession, setOpeningSession] = useState(false)
    const [noSessionOpen, setNoSessionOpen] = useState(false)
    const [printSlip, setPrintSlip] = useState<VoucherSlipData | null>(null)

    const reset = () => {
        setAmount('')
        setPaymentMode('cash')
        setBankName('')
        setParticulars(`Payment to ${partyName}`)
        setReferenceNo('')
        setReceiverName('')
        setStaffEntryType('salary_payout')
        setChequeWrittenName('')
        setChequeBank('')
        setChequeNumber('')
        setChequeDate('')
        setChequeType('ac_payee')
        setNoSessionOpen(false)
    }

    const handleClose = () => {
        reset()
        onClose()
    }

    const handleOpenSession = async () => {
        setOpeningSession(true)
        try {
            const res = await openTodayDayBookSessionAction()
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Day Book session opened successfully!')
                setNoSessionOpen(false)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to open session')
        } finally {
            setOpeningSession(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const amt = parseFloat(amount)
        if (isNaN(amt) || amt <= 0) { toast.error('Enter a valid amount greater than zero'); return }
        if (!particulars.trim()) { toast.error('Particulars / description is required'); return }
        if ((paymentMode === 'qr' || paymentMode === 'cheque') && !bankName) { toast.error('Select a bank account'); return }
        if (paymentMode === 'cheque') {
            if (!chequeWrittenName.trim()) { toast.error('Cheque written name is required'); return }
            if (!chequeBank.trim()) { toast.error('Issuer bank is required'); return }
            if (!chequeNumber.trim()) { toast.error('Cheque number is required'); return }
            if (!chequeDate.trim()) { toast.error('Cheque date is required'); return }
        }

        setSaving(true)
        try {
            const res = await createVoucherAction({
                voucher_type: 'payment',
                party_name: partyName,
                amount: amt,
                payment_mode: paymentMode,
                bank_name: paymentMode !== 'cash' ? bankName : undefined,
                particulars: particulars.trim(),
                reference_no: referenceNo.trim() || undefined,
                receiver_name: receiverName.trim() || undefined,
                category,
                supplier_id: category === 'suppliers' ? partyId : undefined,
                staff_user_id: category === 'staff' ? partyId : undefined,
                staff_entry_type: category === 'staff' ? staffEntryType : undefined,
                cheque_details: paymentMode === 'cheque' ? {
                    written_name: chequeWrittenName.trim(),
                    bank_cheque: chequeBank.trim(),
                    cheque_number: chequeNumber.trim(),
                    cheque_date: chequeDate.trim(),
                    cheque_type: chequeType,
                } : undefined,
            })

            if (res.error) {
                if (res.error.includes('Day Book session')) {
                    setNoSessionOpen(true)
                } else {
                    toast.error(res.error)
                }
                return
            }

            if (!res.data) {
                toast.error('Payment could not be recorded.')
                return
            }

            toast.success('Payment recorded successfully!')
            onSettled({ settledBills: res.settledBills })

            let parsedDesc: Record<string, unknown> = {}
            try { parsedDesc = JSON.parse(res.data.description) } catch { /* fall through */ }

            const shouldPrint = await confirm({
                title: 'Payment Recorded',
                message: 'Print the voucher slip now?',
                confirmText: 'Print Slip',
                cancelText: 'Not Now',
            })

            if (shouldPrint) {
                setPrintSlip({
                    date: res.data.created_at,
                    voucher_type: 'payment',
                    voucher_number: String(parsedDesc.voucher_number ?? ''),
                    party_name: partyName,
                    particulars: particulars.trim(),
                    payment_mode: paymentMode,
                    bank_name: bankName,
                    reference_no: referenceNo.trim(),
                    receiver_name: receiverName.trim(),
                    status: String(parsedDesc.status ?? 'approved') as 'approved' | 'pending_approval' | 'rejected',
                    category,
                    amount: amt,
                    cheque_details: paymentMode === 'cheque' ? {
                        written_name: chequeWrittenName.trim(),
                        bank_cheque: chequeBank.trim(),
                        cheque_number: chequeNumber.trim(),
                        cheque_date: chequeDate.trim(),
                        cheque_type: chequeType,
                    } : undefined,
                })
            }

            reset()
            onClose()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to record payment')
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <Modal open={isOpen} onClose={handleClose} size="md" ariaLabel={`Pay ${partyName}`} className="max-h-[90vh] flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-hairline flex items-center justify-between shrink-0">
                    <div>
                        <h3 className="font-extrabold text-ink">Pay {partyName}</h3>
                        {(currentDue !== undefined || fetchedDue !== null || loadingDue) && (
                            <p className="text-xs text-ink-subtle mt-0.5 flex items-center gap-1">
                                Outstanding:{' '}
                                <span className="font-bold text-rose-600">
                                    {loadingDue ? (
                                        'Loading...'
                                    ) : fetchedDue !== null ? (
                                        formatCurrency(fetchedDue)
                                    ) : (
                                        '0.00'
                                    )}
                                </span>
                            </p>
                        )}
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-6 space-y-4">
                        {noSessionOpen && (
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-3">
                                <p className="text-xs font-bold text-amber-800">No active Day Book session is open.</p>
                                <button
                                    type="button"
                                    onClick={handleOpenSession}
                                    disabled={openingSession}
                                    className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-extrabold rounded-xl text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 shrink-0"
                                >
                                    {openingSession ? <Loader2 size={12} className="animate-spin" /> : null}
                                    Open Day Book Session
                                </button>
                            </div>
                        )}

                        {category === 'staff' && (
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Pay Category</label>
                                <div className="grid grid-cols-3 gap-2">
                                    {STAFF_ENTRY_TYPE_OPTIONS.map(opt => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setStaffEntryType(opt.value)}
                                            className={`py-2 text-[10px] font-black uppercase tracking-wider border rounded-lg transition-all ${
                                                staffEntryType === opt.value ? 'bg-indigo-50 border-indigo-500 text-indigo-700 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                                <p className="text-[10px] text-ink-subtle mt-1">Salary Payout is capped at what&apos;s currently due; Advance Payment and Bonus are not.</p>
                            </div>
                        )}

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Amount (Rs.) *</label>
                            <input
                                type="number"
                                min="0.01"
                                step="0.01"
                                value={amount}
                                onChange={e => setAmount(e.target.value)}
                                required
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-lg font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Payment Method</label>
                            <div className="grid grid-cols-3 gap-2">
                                {(['cash', 'qr', 'cheque'] as const).map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => { setPaymentMode(mode); setBankName('') }}
                                        className={`py-2.5 rounded-xl text-xs font-bold border transition capitalize ${paymentMode === mode ? 'bg-brand-50 border-brand-500 text-brand-600 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {(paymentMode === 'qr' || paymentMode === 'cheque') && (
                            <div className="animate-in slide-in-from-top-1 duration-150">
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Bank Account *</label>
                                <Select
                                    value={bankName}
                                    onChange={e => setBankName(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                                >
                                    <option value="">Select Bank Account</option>
                                    {bankAccounts.map(b => (
                                        <option key={b.id} value={b.name}>{b.name}{b.account_number ? ` (${b.account_number})` : ''}</option>
                                    ))}
                                </Select>
                            </div>
                        )}

                        {paymentMode === 'cheque' && (
                            <div className="space-y-4 border-t border-hairline pt-4 animate-in slide-in-from-top-2 duration-200">
                                <p className="text-xs font-black text-purple-700 uppercase tracking-wider">Cheque Specifications</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Written Name *</label>
                                        <input type="text" value={chequeWrittenName} onChange={e => setChequeWrittenName(e.target.value)} required
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Issuer Bank *</label>
                                        <input type="text" value={chequeBank} onChange={e => setChequeBank(e.target.value)} required
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Number *</label>
                                        <input type="text" value={chequeNumber} onChange={e => setChequeNumber(e.target.value)} required
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Date *</label>
                                        <input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} required
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500" />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Cheque Type</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button type="button" onClick={() => setChequeType('ac_payee')}
                                            className={`py-2 rounded-xl text-xs font-bold border transition ${chequeType === 'ac_payee' ? 'bg-emerald-50 border-emerald-500 text-emerald-700 font-extrabold' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}>
                                            A/C Payee (Company)
                                        </button>
                                        <button type="button" onClick={() => setChequeType('normal')}
                                            className={`py-2 rounded-xl text-xs font-bold border transition ${chequeType === 'normal' ? 'bg-amber-50 border-amber-500 text-amber-700 font-extrabold' : 'bg-surface border-hairline text-ink-subtle hover:bg-surface-muted'}`}>
                                            Normal Person Cheque
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Particulars / Description *</label>
                            <textarea
                                value={particulars}
                                onChange={e => setParticulars(e.target.value)}
                                required
                                rows={2}
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all resize-none"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Reference / Phone (Optional)</label>
                                <input type="tel" value={referenceNo} onChange={e => setReferenceNo(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all" />
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Receiver Staff Name (Optional)</label>
                                <input type="text" value={receiverName} onChange={e => setReceiverName(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all" />
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-hairline bg-surface-muted flex items-center justify-end gap-3 sticky bottom-0">
                        <button type="button" onClick={handleClose} className="px-4 py-2 text-ink-subtle hover:text-ink-subtle font-bold text-sm">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                            Record Payment
                        </button>
                    </div>
                </form>
            </Modal>

            {printSlip && (
                <VoucherPrintSlip voucher={printSlip} onClose={() => setPrintSlip(null)} />
            )}
        </>
    )
}
