'use client'

import { useState, useMemo } from 'react'
import {
    Plus, X, Search, Loader2, Trash2, Edit2, FileText, Phone, DollarSign
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
        <div className="space-y-6 animate-fade-up">
            {/* Header Card */}
            <div className="bg-surface p-5 md:p-6 rounded-[var(--r-md)] border border-hairline shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-extrabold text-ink">Suppliers Ledger</h1>
                        <p className="text-ink-subtle text-sm mt-1">
                            Manage supplier profiles, tax details (PAN/VAT), and track expense purchase ledgers.
                        </p>
                    </div>
                    <button
                        onClick={openAddModal}
                        className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-xl text-sm transition-all shadow-md shadow-brand-500/10 flex items-center justify-center gap-1.5 shrink-0"
                    >
                        <Plus size={16} /> Add Supplier
                    </button>
                </div>
            </div>

            {/* Split View: Left List / Right Ledger details */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Suppliers List Table */}
                <div className={`${ledgerSupplier ? 'lg:col-span-7' : 'lg:col-span-12'} bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm overflow-hidden`}>
                    
                    {/* List Controls */}
                    <div className="p-4 border-b border-hairline bg-surface-muted/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-sm font-black text-ink">Suppliers Directory ({filteredSuppliers.length})</p>
                        
                        {/* Search Bar */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search suppliers..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-1.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]"
                            />
                        </div>
                    </div>

                    {/* Table View */}
                    <div className="overflow-x-auto">
                        {filteredSuppliers.length === 0 ? (
                            <div className="text-center py-16 px-4">
                                <FileText size={40} className="text-ink-subtle mx-auto mb-3 opacity-40" />
                                <p className="text-sm font-bold text-ink-muted">No suppliers found</p>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-surface-muted/20 border-b border-hairline">
                                        <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Supplier Details</th>
                                        <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-28 text-center">PAN / VAT</th>
                                        <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Address</th>
                                        <th className="px-4 py-3 font-bold text-ink-subtle w-32 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-hairline">
                                    {filteredSuppliers.map((s, idx) => {
                                        let parsed = { pan: '', vat: '' }
                                        try {
                                            parsed = JSON.parse(s.contact_person || '{}')
                                        } catch {
                                            // ignore
                                        }
                                        const isSelected = ledgerSupplier?.id === s.id

                                        return (
                                            <tr key={s.id} className={`transition-colors ${isSelected ? 'bg-brand-50/10' : idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/10'} hover:bg-brand-50/5`}>
                                                
                                                {/* Details (Name & Phone) */}
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <p className="font-extrabold text-sm text-ink">{s.name}</p>
                                                    <p className="text-[10px] text-ink-subtle font-semibold flex items-center gap-1 mt-1">
                                                        <Phone size={10} /> {s.phone || 'N/A'}
                                                    </p>
                                                </td>

                                                {/* PAN/VAT Badges */}
                                                <td className="px-4 py-3 border-r border-hairline text-center whitespace-nowrap space-y-1">
                                                    {parsed.pan && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-surface border border-hairline text-ink-muted">
                                                            PAN: {parsed.pan}
                                                        </span>
                                                    )}
                                                    {parsed.vat && (
                                                        <span className="block text-[9px] font-black uppercase px-2 py-0.5 rounded bg-[#ff5a00]/5 border border-[#ff5a00]/10 text-brand-600">
                                                            VAT: {parsed.vat}
                                                        </span>
                                                    )}
                                                    {!parsed.pan && !parsed.vat && (
                                                        <span className="text-[10px] text-ink-muted italic">None</span>
                                                    )}
                                                </td>

                                                {/* Address */}
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink-subtle">
                                                    {s.address || <span className="text-ink-muted italic">None</span>}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-4 py-3 text-center space-x-1.5 whitespace-nowrap">
                                                    <button
                                                        onClick={() => setLedgerSupplier(s)}
                                                        className={`px-2 py-1.5 rounded-lg font-black text-[10px] uppercase border transition-all ${isSelected ? 'bg-brand-500 border-brand-500 text-white' : 'bg-surface hover:bg-surface-muted border-hairline text-ink-subtle hover:text-ink'}`}
                                                    >
                                                        Ledger
                                                    </button>
                                                    <button
                                                        onClick={() => openEditModal(s)}
                                                        className="p-1.5 hover:bg-brand-50/10 hover:text-brand-600 border border-transparent rounded-lg text-ink-subtle transition-all focus-ring inline-flex align-middle"
                                                        title="Edit Supplier"
                                                    >
                                                        <Edit2 size={12} />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDelete(s.id, s.name)}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent rounded-lg text-ink-subtle transition-all focus-ring inline-flex align-middle"
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
                    <div className="lg:col-span-5 bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm overflow-hidden animate-fade-in relative">
                        <button
                            onClick={() => setLedgerSupplier(null)}
                            className="absolute right-4 top-4 p-1.5 text-ink-muted hover:text-ink hover:bg-surface-muted/50 rounded-lg transition-colors focus-ring"
                        >
                            <X size={16} />
                        </button>
                        
                        <div className="p-5 border-b border-hairline bg-surface-muted/20">
                            <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider">Active Statement</span>
                            <h3 className="text-lg font-extrabold text-ink mt-1 truncate pr-8">{ledgerSupplier.name}</h3>
                            
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                <div>
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">PAN / VAT</p>
                                    <p className="font-extrabold text-ink mt-1">
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
                                    <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Address</p>
                                    <p className="font-extrabold text-ink mt-1 truncate">{ledgerSupplier.address || 'None'}</p>
                                </div>
                            </div>
                        </div>

                        {/* Summary Metrics */}
                        <div className="p-4 bg-surface border-b border-hairline grid grid-cols-2 gap-4">
                            <div className="bg-surface border border-hairline p-3.5 rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]">
                                <p className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider">Total Purchases</p>
                                <p className="text-base font-black text-rose-600 mt-1">{formatCurrency(totalSpent)}</p>
                            </div>
                            <div className="bg-surface border border-hairline p-3.5 rounded-xl shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]">
                                <p className="text-[9px] font-bold text-ink-subtle uppercase tracking-wider">Bill count</p>
                                <p className="text-base font-black text-ink mt-1">{supplierExpenses.length} bills</p>
                            </div>
                        </div>

                        {/* List of Purchases/Expenses */}
                        <div className="p-4">
                            <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Linked Expense Bills</p>
                            {supplierExpenses.length === 0 ? (
                                <div className="text-center py-12 border border-dashed border-hairline rounded-2xl text-ink-muted">
                                    <DollarSign size={28} className="mx-auto mb-2 opacity-30" />
                                    <p className="text-xs font-bold">No registered expenses match this supplier name.</p>
                                    <p className="text-[10px] text-ink-subtle mt-1 px-4">Ensure the &quot;Vendor Name&quot; on your Income & Expenses page matches &quot;{ledgerSupplier.name}&quot; exactly.</p>
                                </div>
                            ) : (
                                <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                                    {supplierExpenses.map(e => (
                                        <div key={e.id} className="p-3 border border-hairline rounded-xl flex items-center justify-between gap-3 bg-surface hover:bg-surface-muted/30 transition-colors">
                                            <div className="min-w-0">
                                                <p className="text-xs font-extrabold text-ink truncate">{e.description}</p>
                                                <p className="text-[9px] text-ink-subtle mt-1 font-bold">
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
                <div className="fixed inset-0 z-50 bg-[#0a0a0a]/60 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl border border-hairline shadow-2xl max-w-md w-full overflow-hidden animate-in zoom-in-95 duration-150">
                        
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-hairline flex items-center justify-between">
                            <h3 className="font-extrabold text-ink flex items-center gap-2">
                                <FileText size={18} className="text-brand-500" />
                                {modalOpen === 'create' ? 'Create Supplier profile' : 'Edit Supplier details'}
                            </h3>
                            <button onClick={() => setModalOpen(null)} className="text-ink-muted hover:text-ink">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Form Body */}
                        <form onSubmit={handleSubmit}>
                            <div className="p-6 space-y-4">
                                {/* Name */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Supplier Name *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kathmandu Vegetable Supplier"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                </div>

                                {/* Phone */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Phone Number *</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. 9812345678"
                                        value={phone}
                                        onChange={e => setPhone(e.target.value)}
                                        required
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                </div>

                                {/* PAN / VAT details */}
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">PAN Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="9 digits"
                                            value={pan}
                                            onChange={e => setPan(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">VAT Number (Optional)</label>
                                        <input
                                            type="text"
                                            placeholder="VAT ID"
                                            value={vat}
                                            onChange={e => setVat(e.target.value)}
                                            className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div>
                                    <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Address</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Kalimati, Kathmandu"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                </div>
                            </div>

                            {/* Modal Footer Actions */}
                            <div className="px-6 py-4 border-t border-hairline bg-surface-muted/30 flex items-center justify-end gap-3">
                                <button
                                    type="button"
                                    onClick={() => setModalOpen(null)}
                                    className="px-4 py-2 text-ink-subtle hover:text-ink font-bold text-sm"
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
