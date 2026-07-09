'use client'

import { useState, useMemo } from 'react'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, DollarSign, Truck
} from 'lucide-react'
import { createSupplierAction, updateSupplierAction, deleteSupplierAction } from './actions'
import { toast } from 'react-hot-toast'
import { formatCurrency } from '@/lib/utils'

interface Supplier {
    id: string
    name: string
    phone: string | null
    address: string | null
    contact_person: string | null // Holds JSON { pan: string, vat: string }
    created_at: string
}

interface Expense {
    id: string
    amount: number
    description: string
    vendor_name: string | null
    created_at: string
    expense_categories: { name: string } | null
}

interface SuppliersLedgerManagerProps {
    initialSuppliers: Supplier[]
    expenses: Expense[]
}

export default function SuppliersLedgerManager({
    initialSuppliers,
    expenses
}: SuppliersLedgerManagerProps) {
    const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers)
    const [searchQuery, setSearchQuery] = useState('')

    // Form modals
    const [modalOpen, setModalOpen] = useState<'create' | 'edit' | null>(null)
    const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)

    // Form fields
    const [name, setName] = useState('')
    const [phone, setPhone] = useState('')
    const [pan, setPan] = useState('')
    const [vat, setVat] = useState('')
    const [address, setAddress] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // View Ledger Statement state
    const [ledgerSupplier, setLedgerSupplier] = useState<Supplier | null>(null)

    // Open add modal
    const openAddModal = () => {
        setName('')
        setPhone('')
        setPan('')
        setVat('')
        setAddress('')
        setModalOpen('create')
    }

    // Open edit modal
    const openEditModal = (supplier: Supplier) => {
        let parsed = { pan: '', vat: '' }
        try {
            parsed = JSON.parse(supplier.contact_person || '{}')
        } catch {
            // fallback
        }
        setSelectedSupplier(supplier)
        setName(supplier.name)
        setPhone(supplier.phone || '')
        setPan(parsed.pan || '')
        setVat(parsed.vat || '')
        setAddress(supplier.address || '')
        setModalOpen('edit')
    }

    // Handle submit
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!name.trim()) { toast.error('Supplier name is required'); return }
        if (!phone.trim()) { toast.error('Phone number is required'); return }

        setSubmitting(true)
        try {
            if (modalOpen === 'create') {
                const res = await createSupplierAction({
                    name: name.trim(),
                    phone: phone.trim(),
                    pan: pan.trim(),
                    vat: vat.trim(),
                    address: address.trim()
                })
                if (res.error) {
                    toast.error(res.error)
                } else if (res.data) {
                    setSuppliers(prev => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)))
                    setModalOpen(null)
                    toast.success('Supplier created successfully!')
                }
            } else if (modalOpen === 'edit' && selectedSupplier) {
                const res = await updateSupplierAction(selectedSupplier.id, {
                    name: name.trim(),
                    phone: phone.trim(),
                    pan: pan.trim(),
                    vat: vat.trim(),
                    address: address.trim()
                })
                if (res.error) {
                    toast.error(res.error)
                } else if (res.data) {
                    setSuppliers(prev => prev.map(s => s.id === selectedSupplier.id ? res.data : s))
                    setModalOpen(null)
                    toast.success('Supplier updated successfully!')
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'An error occurred')
        } finally {
            setSubmitting(false)
        }
    }

    // Handle delete
    const handleDelete = async (id: string, sName: string) => {
        if (!confirm(`Are you sure you want to delete the supplier "${sName}"?`)) return

        try {
            const res = await deleteSupplierAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                setSuppliers(prev => prev.filter(s => s.id !== id))
                if (ledgerSupplier?.id === id) setLedgerSupplier(null)
                toast.success('Supplier deleted')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete')
        }
    }

    // Search query filtering
    const filteredSuppliers = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (!q) return suppliers

        return suppliers.filter(s => {
            let panVat = { pan: '', vat: '' }
            try {
                panVat = JSON.parse(s.contact_person || '{}')
            } catch {
                // ignore
            }
            return (
                s.name.toLowerCase().includes(q) ||
                (s.phone && s.phone.includes(q)) ||
                (s.address && s.address.toLowerCase().includes(q)) ||
                panVat.pan.includes(q) ||
                panVat.vat.includes(q)
            )
        })
    }, [suppliers, searchQuery])

    // Find all expenses linked to the selected ledger supplier (matching by name string)
    const supplierExpenses = useMemo(() => {
        if (!ledgerSupplier) return []
        const sNameLower = ledgerSupplier.name.toLowerCase().trim()
        return expenses.filter(e => e.vendor_name?.toLowerCase().trim() === sNameLower)
    }, [ledgerSupplier, expenses])

    const totalSpent = useMemo(() => {
        return supplierExpenses.reduce((sum, e) => sum + Number(e.amount), 0)
    }, [supplierExpenses])

    return (
        <div className="space-y-6 pb-16 animate-fade-up">
            {/* Clean Light Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                            <Truck size={20} className="text-brand-500" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">Suppliers Ledger</h1>
                            <p className="text-xs text-gray-500 mt-0.5">
                                Manage supplier profiles, tax details (PAN/VAT), and track expense purchase ledgers.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={openAddModal}
                        className="flex items-center gap-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-brand-500/20"
                    >
                        <Plus size={16} /> Add Supplier
                    </button>
                </div>
            </div>

            {/* Split View: Left List / Right Ledger details */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Suppliers List Table */}
                <div className={`${ledgerSupplier ? 'lg:col-span-7' : 'lg:col-span-12'} bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden`}>
                    
                    {/* List Controls */}
                    <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-xs font-black text-gray-800 uppercase tracking-wider">Suppliers Directory ({filteredSuppliers.length})</p>
                        
                        {/* Search Bar */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search suppliers..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {/* Table View */}
                    <div className="overflow-x-auto">
                        {filteredSuppliers.length === 0 ? (
                            <div className="text-center py-16 px-4">
                                <FileText size={40} className="text-gray-300 mx-auto mb-3" />
                                <p className="text-xs font-bold text-gray-400">No suppliers found</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                        <th className="px-4 py-3 font-bold text-gray-500">Supplier Details</th>
                                        <th className="px-4 py-3 font-bold text-gray-500 w-28 text-center">PAN / VAT</th>
                                        <th className="px-4 py-3 font-bold text-gray-500">Address</th>
                                        <th className="px-4 py-3 font-bold text-gray-500 w-32 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredSuppliers.map((s, idx) => {
                                        let parsed = { pan: '', vat: '' }
                                        try {
                                            parsed = JSON.parse(s.contact_person || '{}')
                                        } catch {
                                            // ignore
                                        }
                                        const isSelected = ledgerSupplier?.id === s.id

                                        return (
                                            <tr key={s.id} className={`transition-colors ${isSelected ? 'bg-brand-50/20' : idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/20'} hover:bg-gray-50/50`}>
                                                
                                                {/* Details (Name & Phone) */}
                                                <td className="px-4 py-3">
                                                    <p className="font-extrabold text-sm text-gray-900">{s.name}</p>
                                                    <p className="text-[10px] text-gray-500 font-semibold flex items-center gap-1 mt-1">
                                                        <Phone size={10} /> {s.phone || 'N/A'}
                                                    </p>
                                                </td>

                                                {/* PAN/VAT Badges */}
                                                <td className="px-4 py-3 text-center whitespace-nowrap space-y-1">
                                                    {parsed.pan && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                                                            PAN: {parsed.pan}
                                                        </span>
                                                    )}
                                                    {parsed.vat && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">
                                                            VAT: {parsed.vat}
                                                        </span>
                                                    )}
                                                    {!parsed.pan && !parsed.vat && (
                                                        <span className="text-[10px] text-gray-400 italic">None</span>
                                                    )}
                                                </td>

                                                {/* Address */}
                                                <td className="px-4 py-3 font-semibold text-gray-500">
                                                    {s.address || <span className="text-gray-400 italic">None</span>}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-4 py-3 text-center space-x-1.5 whitespace-nowrap">
                                                    <button
                                                        onClick={() => setLedgerSupplier(s)}
                                                        className={`px-2.5 py-1.5 rounded-lg font-black text-[10px] uppercase border transition-all ${isSelected ? 'bg-brand-500 border-brand-500 text-white shadow-sm' : 'bg-white hover:bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-800'}`}
                                                    >
                                                        Ledger
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(s)}
                                                        className="p-1.5 hover:bg-gray-50 hover:text-gray-800 border border-transparent rounded-lg text-gray-400 transition-all inline-flex align-middle"
                                                        title="Edit Supplier"
                                                    >
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s.id, s.name)}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent rounded-lg text-gray-400 transition-all inline-flex align-middle"
                                                        title="Delete Supplier"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                {/* Right Side: Ledger Statement details for the selected Supplier */}
                {ledgerSupplier && (
                    <div className="lg:col-span-5 bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden animate-fade-in relative">
                        <button
                            onClick={() => setLedgerSupplier(null)}
                            className="absolute right-4 top-4 p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
                        >
                            <X size={16} />
                        </button>
                        
                        <div className="p-5 border-b border-gray-100 bg-gray-50/50">
                            <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Active Statement</span>
                            <h3 className="text-lg font-extrabold text-gray-900 mt-1 truncate pr-8">{ledgerSupplier.name}</h3>
                            
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">PAN / VAT</p>
                                    <p className="font-extrabold text-gray-700 mt-1">
                                        {(() => {
                                            try {
                                                const p = JSON.parse(ledgerSupplier.contact_person || '{}')
                                                return [p.pan && `PAN: ${p.pan}`, p.vat && `VAT: ${p.vat}`].filter(Boolean).join(' | ') || 'None'
                                            } catch {
                                                return 'None'
                                            }
                                        })()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Address</p>
                                    <p className="font-extrabold text-gray-700 mt-1 truncate">{ledgerSupplier.address || 'None'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Summary Metrics */}
                        <div className="p-4 bg-white border-b border-gray-100 grid grid-cols-2 gap-4">
                            <div className="bg-white border border-gray-100 p-3.5 rounded-xl shadow-sm">
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Total Purchases</p>
                                <p className="text-base font-black text-rose-600 mt-1">{formatCurrency(totalSpent)}</p>
                            </div>
                            <div className="bg-white border border-gray-100 p-3.5 rounded-xl shadow-sm">
                                <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">Bill count</p>
                                <p className="text-base font-black text-gray-900 mt-1">{supplierExpenses.length} bills</p>
                            </div>
                        </div>

                        {/* List of Purchases/Expenses */}
                        <div className="p-4">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Linked Expense Bills</p>
                            {supplierExpenses.length === 0 ? (
                                <div className="text-center py-12 border border-dashed border-gray-200 rounded-2xl text-gray-400">
                                    <DollarSign size={28} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-xs font-bold">No registered expenses match this supplier name.</p>
                                    <p className="text-[10px] text-gray-400 mt-1 px-4 leading-relaxed">
                                        Ensure the &quot;Vendor Name&quot; on your Income & Expenses page matches &quot;{ledgerSupplier.name}&quot; exactly.
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                                    {supplierExpenses.map(e => (
                                        <div key={e.id} className="p-3 border border-gray-100 rounded-xl flex items-center justify-between gap-3 bg-white hover:bg-gray-50/50 transition-colors">
                                            <div className="min-w-0">
                                                <p className="text-xs font-extrabold text-gray-800 truncate">{e.description}</p>
                                                <p className="text-[9px] text-gray-400 mt-1 font-bold">
                                                    {new Date(e.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                                                    {e.expense_categories && ` • ${e.expense_categories.name}`}
                                                </p>
                                            </div>
                                            <p className="text-xs font-black text-rose-600 shrink-0">{formatCurrency(e.amount)}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Modal Dialog Form */}
            {modalOpen && (
                <div className="fixed inset-0 z-50 bg-gray-900/40 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 flex items-center gap-2">
                                <FileText size={18} className="text-brand-500" />
                                {modalOpen === 'create' ? 'Create Supplier profile' : 'Edit Supplier details'}
                            </h3>
                            <button onClick={() => setModalOpen(null)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                {/* Name */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Supplier Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kathmandu Vegetable Supplier"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* Phone */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Phone Number *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9812345678"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>

                                {/* PAN / VAT details */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">PAN Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="9 digits"
                                            value={pan}
                                            onChange={e => setPan(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">VAT Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="VAT ID"
                                            value={vat}
                                            onChange={e => setVat(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Address</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kalimati, Kathmandu"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(null)}
                                    className="px-4 py-2 text-gray-400 hover:text-gray-600 font-bold text-sm"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    className="px-6 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-extrabold text-sm rounded-xl flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                                >
                                    {submitting && <Loader2 size={14} className="animate-spin" />}
                                    {modalOpen === 'create' ? 'Create Supplier' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}
