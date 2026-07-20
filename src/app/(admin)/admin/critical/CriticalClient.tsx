'use client'

import { useState, useMemo } from 'react'
import { useFeatures } from '@/lib/contexts/FeatureContext'
import { AlertTriangle, Check, X, Loader2, Plus, ArrowRight, Coins, Bed, ShoppingBag, Landmark, ArrowUpRight } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { addStockMovementAction } from '@/app/(admin)/admin/ingredients/actions'
import { createSupplierBillAction } from '@/app/(admin)/admin/suppliers/actions'
import { approveChequeAction, rejectChequeAction } from '@/app/(admin)/admin/vouchers/actions'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'

interface Ingredient {
    id: string
    name: string
    stock_quantity: number
    reorder_level: number | null
    unit: string
    cost_per_unit: number | null
    supplier: string | null
    category_id: string | null
}

interface RawVoucherEntry {
    id: string
    session_id: string
    type: string
    amount: number
    description: string
    created_at: string
    day_book_sessions?: {
        date: string
    } | null
}

interface SupplierBill {
    id: string
    bill_number: string | null
    amount: number
    paid_amount: number
    supplier_id: string
    due_date: string
    created_at: string
    status: string
    suppliers?: {
        name: string
    } | null
}

interface Supplier {
    id: string
    name: string
    category_id: string | null
}

interface Category {
    id: string
    name: string
    is_stock_category: boolean
}

interface CriticalClientProps {
    restaurantId: string
    currentUserId: string
    lowStock: Ingredient[]
    initialVouchers: RawVoucherEntry[]
    supplierBills: SupplierBill[]
    suppliers: Supplier[]
    categories: Category[]
}

const fmt = (n: number) => `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(n))}`

export default function CriticalClient({
    restaurantId,
    currentUserId,
    lowStock: initialLowStock,
    initialVouchers,
    supplierBills: initialSupplierBills,
    suppliers,
    categories
}: CriticalClientProps) {
    const { confirm } = useConfirmStore()
    const { financeEnabled } = useFeatures()
    const [lowStockList, setLowStockList] = useState<Ingredient[]>(initialLowStock)
    const [vouchers, setVouchers] = useState<RawVoucherEntry[]>(initialVouchers)
    const [supplierBills, setSupplierBills] = useState<SupplierBill[]>(initialSupplierBills)

    const [activeTab, setActiveTab] = useState<'stock' | 'vouchers' | 'bills'>('stock')
    const [actioningId, setActioningId] = useState<string | null>(null)

    // Purchase Modal State
    const [purchasingItem, setPurchasingItem] = useState<Ingredient | null>(null)
    const [purchaseQty, setPurchaseQty] = useState('')
    const [purchaseRate, setPurchaseRate] = useState('')
    const [selectedSupplierId, setSelectedSupplierId] = useState('')
    const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false)

    // Parse pending vouchers description
    const parsedVouchers = useMemo(() => {
        return vouchers.map(v => {
            let parsed = {
                voucher_type: 'payment',
                voucher_number: 'N/A',
                party_name: 'N/A',
                particulars: v.description,
                payment_mode: 'cash',
                bank_name: '',
                reference_no: '',
                receiver_name: '',
                status: 'pending_approval',
                amount: Number(v.amount),
                category: 'other'
            }
            try {
                if (v.description.startsWith('{')) {
                    parsed = { ...parsed, ...JSON.parse(v.description) }
                }
            } catch {}
            return {
                id: v.id,
                date: v.day_book_sessions?.date || v.created_at.split('T')[0],
                ...parsed
            }
        })
    }, [vouchers])

    // Approve voucher handler (reuses existing logic, avoids double entry)
    const handleApproveVoucher = async (id: string) => {
        setActioningId(id)
        try {
            const res = await approveChequeAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Voucher approved and cleared successfully!')
                setVouchers(prev => prev.filter(v => v.id !== id))
            }
        } catch (err) {
            toast.error('Failed to approve voucher')
        } finally {
            setActioningId(null)
        }
    }

    // Reject voucher handler
    const handleRejectVoucher = async (id: string) => {
        const ok = await confirm({ title: 'Are you sure you want to reject this voucher?', message: 'This action cannot be undone.', confirmText: 'Reject', isDestructive: true })
        if (!ok) return
        setActioningId(id)
        try {
            const res = await rejectChequeAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Voucher marked as rejected.')
                setVouchers(prev => prev.filter(v => v.id !== id))
            }
        } catch (err) {
            toast.error('Failed to reject voucher')
        } finally {
            setActioningId(null)
        }
    }

    // Handle Quick Stock Purchase (Linked workflow to remove double entry!)
    const handleConfirmPurchase = async () => {
        if (!purchasingItem || !purchaseQty || !purchaseRate || !selectedSupplierId) {
            toast.error('Please fill in all required fields.')
            return
        }

        const qty = parseFloat(purchaseQty)
        const rate = parseFloat(purchaseRate)
        if (isNaN(qty) || qty <= 0 || isNaN(rate) || rate <= 0) {
            toast.error('Enter valid quantity and rate.')
            return
        }

        setIsSubmittingPurchase(true)
        try {
            // 1. Post stock movement
            const moveRes = await addStockMovementAction({
                ingredient_id: purchasingItem.id,
                movement_type: 'purchase',
                quantity: qty,
                notes: `Critical stock replenishment`,
                performed_by: currentUserId
            })

            if (moveRes.error) {
                toast.error(`Stock update failed: ${moveRes.error}`)
                setIsSubmittingPurchase(false)
                return
            }

            // 2. Post supplier bill automatically (prevents double entry)
            const supplier = suppliers.find(s => s.id === selectedSupplierId)
            const supplierName = supplier?.name || purchasingItem.supplier || 'Unspecified Supplier'
            const categoryId = purchasingItem.category_id || categories.find(c => c.is_stock_category)?.id || ''

            const billRes = await createSupplierBillAction({
                supplier_name: supplierName,
                category_id: categoryId,
                text_desc: `Critical restock: ${purchasingItem.name}`,
                quantity: qty,
                rate: rate,
                unit: purchasingItem.unit,
                amount: qty * rate,
                paid_amount: 0,
                payment_source: 'cash'
            })

            if (billRes.error) {
                toast.error(`Stock updated, but supplier bill couldn't be auto-posted: ${billRes.error}`)
            } else {
                toast.success('Stock replenished and supplier bill auto-recorded!')
            }

            // Remove from low stock list if quantity is now above reorder
            setLowStockList(prev => prev.map(i => {
                if (i.id === purchasingItem.id) {
                    return { ...i, stock_quantity: Number(i.stock_quantity) + qty }
                }
                return i
            }).filter(i => i.reorder_level !== null && Number(i.stock_quantity) <= Number(i.reorder_level)))

            setPurchasingItem(null)
            setPurchaseQty('')
            setPurchaseRate('')
            setSelectedSupplierId('')
        } catch (e) {
            toast.error('Stock purchase flow failed.')
        } finally {
            setIsSubmittingPurchase(false)
        }
    }

    return (
        <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-4 border-b border-hairline pb-6">
                <div className="w-12 h-12 rounded-[var(--r-xl)] bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100 shadow-[inset_0_2px_4px_rgba(225,29,72,0.05)]">
                    <AlertTriangle size={24} className="animate-pulse" />
                </div>
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-ink tracking-tight">Critical Alerts & Operations</h1>
                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-1">
                        Handle low stocks, approve pending vouchers, and view unpaid dues
                    </p>
                </div>
            </div>

            {/* Summary Cards */}
            <div className={`grid gap-4 md:gap-6 ${financeEnabled ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1'}`}>
                {/* Stock Card */}
                <button 
                    onClick={() => setActiveTab('stock')}
                    className={`p-6 rounded-[24px] border-2 text-left cursor-pointer transition-all duration-300 ${
                        activeTab === 'stock' 
                            ? 'border-rose-500 bg-rose-50/30 shadow-[0_8px_24px_rgba(225,29,72,0.15)] ring-4 ring-rose-500/10 -translate-y-1' 
                            : 'border-hairline bg-surface hover:bg-surface-muted/30 hover:border-rose-200 hover:-translate-y-0.5 shadow-sm'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${activeTab === 'stock' ? 'text-rose-700' : 'text-ink-subtle'}`}>Low Stock Items</span>
                        <div className={`p-2.5 rounded-[14px] ${lowStockList.length > 0 ? (activeTab === 'stock' ? 'bg-rose-500 text-white shadow-md' : 'bg-rose-100 text-rose-600') : 'bg-surface-muted text-ink-muted'}`}>
                            <AlertTriangle size={18} />
                        </div>
                    </div>
                    <p className={`text-4xl font-black mt-4 ${activeTab === 'stock' ? 'text-rose-700' : 'text-ink'}`}>{lowStockList.length}</p>
                    <p className={`text-xs font-semibold mt-2 ${activeTab === 'stock' ? 'text-rose-600/80' : 'text-ink-muted'}`}>Requires stock purchase</p>
                </button>

                {financeEnabled && (
                    <>
                        {/* Vouchers Card */}
                        <button 
                            onClick={() => setActiveTab('vouchers')}
                            className={`p-6 rounded-[24px] border-2 text-left cursor-pointer transition-all duration-300 ${
                                activeTab === 'vouchers' 
                                    ? 'border-amber-500 bg-amber-50/30 shadow-[0_8px_24px_rgba(245,158,11,0.15)] ring-4 ring-amber-500/10 -translate-y-1' 
                                    : 'border-hairline bg-surface hover:bg-surface-muted/30 hover:border-amber-200 hover:-translate-y-0.5 shadow-sm'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-[11px] font-bold uppercase tracking-wider ${activeTab === 'vouchers' ? 'text-amber-700' : 'text-ink-subtle'}`}>Pending Vouchers</span>
                                <div className={`p-2.5 rounded-[14px] ${vouchers.length > 0 ? (activeTab === 'vouchers' ? 'bg-amber-500 text-white shadow-md' : 'bg-amber-100 text-amber-600') : 'bg-surface-muted text-ink-muted'}`}>
                                    <Landmark size={18} />
                                </div>
                            </div>
                            <p className={`text-4xl font-black mt-4 ${activeTab === 'vouchers' ? 'text-amber-700' : 'text-ink'}`}>{vouchers.length}</p>
                            <p className={`text-xs font-semibold mt-2 ${activeTab === 'vouchers' ? 'text-amber-600/80' : 'text-ink-muted'}`}>Awaiting supervisor approval</p>
                        </button>

                        {/* Bills Card */}
                        <button 
                            onClick={() => setActiveTab('bills')}
                            className={`p-6 rounded-[24px] border-2 text-left cursor-pointer transition-all duration-300 ${
                                activeTab === 'bills' 
                                    ? 'border-indigo-500 bg-indigo-50/30 shadow-[0_8px_24px_rgba(99,102,241,0.15)] ring-4 ring-indigo-500/10 -translate-y-1' 
                                    : 'border-hairline bg-surface hover:bg-surface-muted/30 hover:border-indigo-200 hover:-translate-y-0.5 shadow-sm'
                            }`}
                        >
                            <div className="flex items-center justify-between">
                                <span className={`text-[11px] font-bold uppercase tracking-wider ${activeTab === 'bills' ? 'text-indigo-700' : 'text-ink-subtle'}`}>Supplier Unpaid Dues</span>
                                <div className={`p-2.5 rounded-[14px] ${supplierBills.length > 0 ? (activeTab === 'bills' ? 'bg-indigo-500 text-white shadow-md' : 'bg-indigo-100 text-indigo-600') : 'bg-surface-muted text-ink-muted'}`}>
                                    <Coins size={18} />
                                </div>
                            </div>
                            <p className={`text-4xl font-black mt-4 ${activeTab === 'bills' ? 'text-indigo-700' : 'text-ink'}`}>{supplierBills.length}</p>
                            <p className={`text-xs font-semibold mt-2 ${activeTab === 'bills' ? 'text-indigo-600/80' : 'text-ink-muted'}`}>Awaiting settlement payouts</p>
                        </button>
                    </>
                )}
            </div>

            {/* Central Worksheets */}
            <div className="bg-surface border border-hairline rounded-[24px] overflow-hidden shadow-sm mt-4">
                <div className="border-b border-hairline bg-surface-muted/30 px-6 py-5 flex items-center justify-between">
                    <span className="text-[11px] font-black text-ink uppercase tracking-wider">
                        {activeTab === 'stock' ? 'Critical Inventory & Stock down status' : activeTab === 'vouchers' ? 'Vouchers / Cheques approvals queue' : 'Supplier Unpaid Invoices'}
                    </span>
                </div>

                {activeTab === 'stock' && (
                    <div className="p-0">
                        {lowStockList.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center">
                                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-3">
                                    <Check size={24} />
                                </div>
                                <p className="text-sm font-bold text-ink">All Clear!</p>
                                <p className="text-xs text-ink-subtle mt-1">All ingredient stock levels are above reorder limits.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="border-b border-hairline bg-surface-muted/10 text-[10px] text-ink-subtle uppercase font-black tracking-wider">
                                            <th className="py-4 px-6 font-bold">Ingredient Name</th>
                                            <th className="py-4 px-6 font-bold">Current Stock</th>
                                            <th className="py-4 px-6 font-bold">Reorder Limit</th>
                                            <th className="py-4 px-6 font-bold">Unit Cost</th>
                                            <th className="py-4 px-6 font-bold text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {lowStockList.map(item => (
                                            <tr key={item.id} className="hover:bg-surface-muted/20 transition-colors group">
                                                <td className="py-4 px-6 text-ink font-black">{item.name}</td>
                                                <td className="py-4 px-6 text-rose-600 font-black">
                                                    <span className="bg-rose-50 px-2 py-1 rounded-md border border-rose-100">{item.stock_quantity} {item.unit}</span>
                                                </td>
                                                <td className="py-4 px-6 text-ink-muted font-semibold">{item.reorder_level} {item.unit}</td>
                                                <td className="py-4 px-6 text-ink font-semibold">{item.cost_per_unit ? fmt(item.cost_per_unit) : 'N/A'}</td>
                                                <td className="py-4 px-6 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setPurchasingItem(item)
                                                            setPurchaseQty(String((item.reorder_level || 10) - item.stock_quantity + 10))
                                                            setPurchaseRate(String(item.cost_per_unit || ''))
                                                            const match = suppliers.find(s => s.name.toLowerCase() === item.supplier?.toLowerCase())
                                                            setSelectedSupplierId(match?.id || '')
                                                        }}
                                                        className="px-4 py-2 bg-brand-50 hover:bg-brand-100 text-brand-600 border border-brand-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ml-auto opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                    >
                                                        <Plus size={14} />
                                                        Buy & Restock
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'vouchers' && (
                    <div className="p-6">
                        {parsedVouchers.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center">
                                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-3">
                                    <Check size={24} />
                                </div>
                                <p className="text-sm font-bold text-ink">Queue Empty</p>
                                <p className="text-xs text-ink-subtle mt-1">No vouchers currently require manager approval.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {parsedVouchers.map(v => (
                                    <div key={v.id} className="p-5 border border-hairline rounded-[20px] flex flex-col md:flex-row md:items-center justify-between bg-surface hover:border-brand-300 hover:shadow-md transition-all gap-4">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-[10px] font-extrabold uppercase border border-amber-200 tracking-wider">
                                                    Pending {v.voucher_type}
                                                </span>
                                                <span className="text-xs font-black text-ink bg-surface-muted px-2 py-0.5 rounded">{v.voucher_number}</span>
                                                <span className="text-[11px] text-ink-subtle font-bold uppercase tracking-wider">{v.date}</span>
                                            </div>
                                            <p className="text-sm font-black text-ink mt-2">{v.party_name}</p>
                                            <p className="text-xs text-ink-muted font-medium">{v.particulars}</p>
                                            {v.reference_no && <p className="text-[10px] text-ink-subtle font-bold uppercase">Ref: {v.reference_no}</p>}
                                        </div>
                                        <div className="text-left md:text-right space-y-3 shrink-0">
                                            <p className="text-xl font-black text-ink">{fmt(v.amount)}</p>
                                            <div className="flex gap-2 justify-start md:justify-end">
                                                <button
                                                    onClick={() => handleRejectVoucher(v.id)}
                                                    disabled={actioningId === v.id}
                                                    className="p-2.5 rounded-xl border border-hairline-strong text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition focus-ring"
                                                    title="Reject Voucher"
                                                >
                                                    <X size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleApproveVoucher(v.id)}
                                                    disabled={actioningId === v.id}
                                                    className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-xs transition flex items-center gap-2 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:-translate-y-0.5 disabled:opacity-50 focus-ring"
                                                >
                                                    {actioningId === v.id ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                                    Approve
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'bills' && (
                    <div className="p-0">
                        {supplierBills.length === 0 ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center">
                                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center mb-3">
                                    <Check size={24} />
                                </div>
                                <p className="text-sm font-bold text-ink">All Settled</p>
                                <p className="text-xs text-ink-subtle mt-1">No outstanding supplier dues. Fantastic credit health!</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="border-b border-hairline bg-surface-muted/10 text-[10px] text-ink-subtle uppercase font-black tracking-wider">
                                            <th className="py-4 px-6 font-bold">Bill Number</th>
                                            <th className="py-4 px-6 font-bold">Supplier</th>
                                            <th className="py-4 px-6 font-bold">Due Date</th>
                                            <th className="py-4 px-6 font-bold">Outstanding Amount</th>
                                            <th className="py-4 px-6 font-bold text-right">Navigate</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {supplierBills.map(bill => (
                                            <tr key={bill.id} className="hover:bg-surface-muted/20 transition-colors">
                                                <td className="py-4 px-6 text-ink font-black">{bill.bill_number || 'N/A'}</td>
                                                <td className="py-4 px-6 text-ink font-semibold">{bill.suppliers?.name || 'N/A'}</td>
                                                <td className="py-4 px-6 text-rose-600 font-bold text-xs">{bill.due_date}</td>
                                                <td className="py-4 px-6 text-ink font-black">{fmt(bill.amount - bill.paid_amount)}</td>
                                                <td className="py-4 px-6 text-right">
                                                    <a
                                                        href="/admin/finance/payables"
                                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition"
                                                    >
                                                        Payables Panel
                                                        <ArrowUpRight size={14} />
                                                    </a>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Quick Purchase Modal */}
            {purchasingItem && (
                <div className="fixed inset-0 z-[200] bg-ink/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-card shadow-2xl border border-hairline max-w-sm w-full p-6 space-y-5 animate-in zoom-in-95 duration-200">
                        <div className="flex items-start justify-between border-b border-hairline pb-4">
                            <div>
                                <h3 className="font-black text-ink text-sm">Replenish Stock</h3>
                                <p className="text-[11px] text-ink-subtle font-bold uppercase tracking-wider mt-1">{purchasingItem.name}</p>
                            </div>
                            <button 
                                onClick={() => setPurchasingItem(null)}
                                className="p-1.5 rounded-xl hover:bg-surface-muted text-ink-muted hover:text-ink transition-colors focus-ring"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Select Supplier *</label>
                                <Select
                                    value={selectedSupplierId}
                                    onChange={e => setSelectedSupplierId(e.target.value)}
                                    required
                                    className="w-full px-4 py-2.5 bg-surface border border-hairline-strong rounded-[var(--r-md)] text-sm font-bold text-ink focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all appearance-none"
                                >
                                    <option value="">Select Supplier...</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </Select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Quantity ({purchasingItem.unit}) *</label>
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="any"
                                        value={purchaseQty}
                                        onChange={e => setPurchaseQty(e.target.value)}
                                        className="w-full px-4 py-2.5 border border-hairline-strong rounded-[var(--r-md)] text-sm font-bold bg-surface focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Rate (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={purchaseRate}
                                        onChange={e => setPurchaseRate(e.target.value)}
                                        className="w-full px-4 py-2.5 border border-hairline-strong rounded-[var(--r-md)] text-sm font-bold bg-surface focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 transition-all"
                                    />
                                </div>
                            </div>

                            {purchaseQty && purchaseRate && (
                                <div className="p-3.5 bg-brand-50 border border-brand-100 rounded-[var(--r-md)] flex items-center justify-between text-sm font-black shadow-[inset_0_2px_4px_rgba(251,99,3,0.02)]">
                                    <span className="text-brand-700 uppercase tracking-wider text-[10px] font-bold">Total Bill:</span>
                                    <span className="text-brand-600">{fmt(Number(purchaseQty) * Number(purchaseRate))}</span>
                                </div>
                            )}

                            <button
                                onClick={handleConfirmPurchase}
                                disabled={isSubmittingPurchase || !selectedSupplierId || !purchaseQty || !purchaseRate}
                                className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-[var(--r-md)] text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:-translate-y-0.5 focus-ring"
                            >
                                {isSubmittingPurchase ? <Loader2 size={16} className="animate-spin" /> : null}
                                Confirm & Record Bill
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
