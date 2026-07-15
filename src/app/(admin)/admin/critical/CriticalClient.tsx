'use client'

import { useState, useMemo } from 'react'
import { AlertTriangle, Check, X, Loader2, Plus, ArrowRight, Coins, Bed, ShoppingBag, Landmark, ArrowUpRight } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { addStockMovementAction } from '@/app/(admin)/admin/ingredients/actions'
import { createSupplierBillAction } from '@/app/(admin)/admin/suppliers/actions'
import { approveChequeAction, rejectChequeAction } from '@/app/(admin)/admin/vouchers/actions'

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
        if (!confirm('Are you sure you want to reject this voucher?')) return
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
        <div className="p-6 space-y-6">
            <div>
                <h1 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                    <AlertTriangle className="text-amber-500 animate-pulse" size={26} />
                    Critical Alerts & Operations Center
                </h1>
                <p className="text-xs text-gray-500 font-semibold mt-1">
                    Direct workflow panel to handle low stocks, approve pending vouchers, and view unpaid dues in one centralized location.
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-6">
                <div 
                    onClick={() => setActiveTab('stock')}
                    className={`p-6 rounded-3xl border-2 cursor-pointer transition-all duration-200 ${
                        activeTab === 'stock' 
                            ? 'border-rose-500 bg-rose-50/20 shadow-md shadow-rose-100' 
                            : 'border-gray-100 bg-white hover:border-rose-200'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Low Stock Items</span>
                        <div className={`p-2 rounded-xl ${lowStockList.length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-gray-100 text-gray-400'}`}>
                            <AlertTriangle size={18} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-gray-900 mt-4">{lowStockList.length}</p>
                    <p className="text-[11px] text-gray-400 font-semibold mt-2">Requires stock purchase</p>
                </div>

                <div 
                    onClick={() => setActiveTab('vouchers')}
                    className={`p-6 rounded-3xl border-2 cursor-pointer transition-all duration-200 ${
                        activeTab === 'vouchers' 
                            ? 'border-amber-500 bg-amber-50/20 shadow-md shadow-amber-100' 
                            : 'border-gray-100 bg-white hover:border-amber-200'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pending Vouchers</span>
                        <div className={`p-2 rounded-xl ${vouchers.length > 0 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
                            <Landmark size={18} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-gray-900 mt-4">{vouchers.length}</p>
                    <p className="text-[11px] text-gray-400 font-semibold mt-2">Awaiting supervisor approval</p>
                </div>

                <div 
                    onClick={() => setActiveTab('bills')}
                    className={`p-6 rounded-3xl border-2 cursor-pointer transition-all duration-200 ${
                        activeTab === 'bills' 
                            ? 'border-indigo-500 bg-indigo-50/20 shadow-md shadow-indigo-100' 
                            : 'border-gray-100 bg-white hover:border-indigo-200'
                    }`}
                >
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Supplier Unpaid Dues</span>
                        <div className={`p-2 rounded-xl ${supplierBills.length > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                            <Coins size={18} />
                        </div>
                    </div>
                    <p className="text-3xl font-black text-gray-900 mt-4">{supplierBills.length}</p>
                    <p className="text-[11px] text-gray-400 font-semibold mt-2">Awaiting settlement payouts</p>
                </div>
            </div>

            {/* Central Worksheets */}
            <div className="bg-white border border-gray-150 rounded-3xl overflow-hidden shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50/40 px-6 py-4 flex items-center justify-between">
                    <span className="text-sm font-black text-gray-800 uppercase tracking-wide">
                        {activeTab === 'stock' ? 'Critical Inventory & Stock down status' : activeTab === 'vouchers' ? 'Vouchers / Cheques approvals queue' : 'Supplier Unpaid Invoices'}
                    </span>
                </div>

                {activeTab === 'stock' && (
                    <div className="p-6">
                        {lowStockList.length === 0 ? (
                            <p className="text-xs text-gray-400 italic text-center py-8">All ingredient stock levels are above reorder limits. Good job!</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-gray-100 text-gray-400 uppercase font-black tracking-wider">
                                            <th className="py-3 px-4">Ingredient Name</th>
                                            <th className="py-3 px-4">Current Stock</th>
                                            <th className="py-3 px-4">Reorder Limit</th>
                                            <th className="py-3 px-4">Unit Cost</th>
                                            <th className="py-3 px-4 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {lowStockList.map(item => (
                                            <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50 font-bold text-gray-700">
                                                <td className="py-4 px-4 text-gray-900 font-black">{item.name}</td>
                                                <td className="py-4 px-4 text-rose-600 font-black">{item.stock_quantity} {item.unit}</td>
                                                <td className="py-4 px-4 text-gray-500">{item.reorder_level} {item.unit}</td>
                                                <td className="py-4 px-4 text-gray-500">{item.cost_per_unit ? fmt(item.cost_per_unit) : 'N/A'}</td>
                                                <td className="py-4 px-4 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setPurchasingItem(item)
                                                            setPurchaseQty(String((item.reorder_level || 10) - item.stock_quantity + 10))
                                                            setPurchaseRate(String(item.cost_per_unit || ''))
                                                            const match = suppliers.find(s => s.name.toLowerCase() === item.supplier?.toLowerCase())
                                                            setSelectedSupplierId(match?.id || '')
                                                        }}
                                                        className="px-3.5 py-1.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white rounded-xl text-[11px] font-bold transition flex items-center gap-1 ml-auto"
                                                    >
                                                        <Plus size={12} />
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
                            <p className="text-xs text-gray-400 italic text-center py-8">No vouchers currently require manager approval. All clear!</p>
                        ) : (
                            <div className="space-y-4">
                                {parsedVouchers.map(v => (
                                    <div key={v.id} className="p-5 border border-gray-150 rounded-2xl flex items-start justify-between bg-white hover:border-indigo-150 transition">
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-[10px] font-bold uppercase border border-amber-100">
                                                    Pending {v.voucher_type}
                                                </span>
                                                <span className="text-xs font-black text-gray-900">{v.voucher_number}</span>
                                                <span className="text-xs text-gray-400 font-semibold">{v.date}</span>
                                            </div>
                                            <p className="text-[13px] font-black text-gray-800">Party: {v.party_name}</p>
                                            <p className="text-xs text-gray-500 font-semibold">Details: {v.particulars}</p>
                                            {v.reference_no && <p className="text-[10px] text-gray-400 font-semibold">Ref: {v.reference_no}</p>}
                                        </div>
                                        <div className="text-right space-y-3">
                                            <p className="text-lg font-black text-gray-900">{fmt(v.amount)}</p>
                                            <div className="flex gap-2 justify-end">
                                                <button
                                                    onClick={() => handleRejectVoucher(v.id)}
                                                    disabled={actioningId === v.id}
                                                    className="p-1.5 rounded-xl border border-gray-200 text-rose-600 hover:bg-rose-50 transition"
                                                >
                                                    <X size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleApproveVoucher(v.id)}
                                                    disabled={actioningId === v.id}
                                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-[11px] transition flex items-center gap-1.5"
                                                >
                                                    {actioningId === v.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                    Approve Voucher
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
                    <div className="p-6">
                        {supplierBills.length === 0 ? (
                            <p className="text-xs text-gray-400 italic text-center py-8">No outstanding supplier dues. Fantastic credit health!</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="border-b border-gray-100 text-gray-400 uppercase font-black tracking-wider">
                                            <th className="py-3 px-4">Bill Number</th>
                                            <th className="py-3 px-4">Supplier</th>
                                            <th className="py-3 px-4">Due Date</th>
                                            <th className="py-3 px-4">Outstanding Amount</th>
                                            <th className="py-3 px-4 text-right">Navigate</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {supplierBills.map(bill => (
                                            <tr key={bill.id} className="border-b border-gray-50 hover:bg-gray-50/50 font-bold text-gray-700">
                                                <td className="py-4 px-4 text-gray-900 font-black">{bill.bill_number || 'N/A'}</td>
                                                <td className="py-4 px-4 text-gray-700">{bill.suppliers?.name || 'N/A'}</td>
                                                <td className="py-4 px-4 text-rose-600">{bill.due_date}</td>
                                                <td className="py-4 px-4 text-gray-900 font-black">{fmt(bill.amount - bill.paid_amount)}</td>
                                                <td className="py-4 px-4 text-right">
                                                    <a
                                                        href="/admin/finance/payables"
                                                        className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800 transition"
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
                <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-white rounded-[28px] shadow-2xl border border-gray-100 max-w-sm w-full p-6 space-y-4">
                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                            <div>
                                <h3 className="font-black text-gray-900 text-sm">Replenish Stock</h3>
                                <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{purchasingItem.name}</p>
                            </div>
                            <button 
                                onClick={() => setPurchasingItem(null)}
                                className="p-1 rounded-lg hover:bg-gray-50 text-gray-400"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-3.5">
                            <div>
                                <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Select Supplier *</label>
                                <select
                                    value={selectedSupplierId}
                                    onChange={e => setSelectedSupplierId(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:border-[#ff5a00]"
                                >
                                    <option value="">Select Supplier...</option>
                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Quantity ({purchasingItem.unit}) *</label>
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="any"
                                        value={purchaseQty}
                                        onChange={e => setPurchaseQty(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-[#ff5a00]"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[9px] font-black text-gray-400 uppercase tracking-wider mb-1">Rate (Rs.) *</label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        value={purchaseRate}
                                        onChange={e => setPurchaseRate(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs font-bold bg-white focus:outline-none focus:border-[#ff5a00]"
                                    />
                                </div>
                            </div>

                            {purchaseQty && purchaseRate && (
                                <div className="p-3 bg-gray-50 border border-gray-150 rounded-2xl flex items-center justify-between text-xs font-bold">
                                    <span className="text-gray-400 uppercase text-[9px]">Total Bill Amount:</span>
                                    <span className="text-gray-900">{fmt(Number(purchaseQty) * Number(purchaseRate))}</span>
                                </div>
                            )}

                            <button
                                onClick={handleConfirmPurchase}
                                disabled={isSubmittingPurchase || !selectedSupplierId || !purchaseQty || !purchaseRate}
                                className="w-full py-2.5 bg-[#ff5a00] hover:bg-[#ff4500] text-white font-bold rounded-xl text-xs transition disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                                {isSubmittingPurchase ? <Loader2 size={12} className="animate-spin" /> : null}
                                Confirm & Record Bill
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
