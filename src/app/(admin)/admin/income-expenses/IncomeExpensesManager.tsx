'use client'

import { useState, useMemo } from 'react'
import {
    TrendingUp, TrendingDown, Trash2, Plus, X,
    Search, Loader2, ArrowRightLeft, FileText, User
} from 'lucide-react'
import { createCategoryAction, deleteCategoryAction, createEntryAction, deleteEntryAction } from './actions'
import { toast } from 'react-hot-toast'
import { formatCurrency } from '@/lib/utils'

interface Category {
    id: string
    name: string
    description: string | null
}

interface IncomeEntry {
    id: string
    amount: number
    description: string
    created_at: string
    category_id: string
    income_categories: Category | null
}

interface ExpenseEntry {
    id: string
    amount: number
    description: string
    vendor_name: string | null
    created_at: string
    category_id: string
    expense_categories: Category | null
}

interface IncomeExpensesManagerProps {
    initialIncomeCategories: Category[]
    initialExpenseCategories: Category[]
    initialIncomeEntries: IncomeEntry[]
    initialExpenses: ExpenseEntry[]
}

export default function IncomeExpensesManager({
    initialIncomeCategories,
    initialExpenseCategories,
    initialIncomeEntries,
    initialExpenses
}: IncomeExpensesManagerProps) {
    // Categories & Entries state
    const [incomeCategories, setIncomeCategories] = useState<Category[]>(initialIncomeCategories)
    const [expenseCategories, setExpenseCategories] = useState<Category[]>(initialExpenseCategories)
    const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>(initialIncomeEntries)
    const [expenses, setExpenses] = useState<ExpenseEntry[]>(initialExpenses)

    // Form tab and inputs
    const [activeTab, setActiveTab] = useState<'income' | 'expense'>('income')
    const [amount, setAmount] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [description, setDescription] = useState('')
    const [vendorName, setVendorName] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // Category modal/inline-editor
    const [showNewCatForm, setShowNewCatForm] = useState(false)
    const [newCatName, setNewCatName] = useState('')
    const [newCatDesc, setNewCatDesc] = useState('')
    const [submittingCat, setSubmittingCat] = useState(false)

    // List tab and filters
    const [listTab, setListTab] = useState<'income' | 'expense'>('income')
    const [searchQuery, setSearchQuery] = useState('')
    const [timeFilter, setTimeFilter] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all')

    // Time-range filtered entries (aligned to Nepal Standard Time boundaries)
    const timeFilteredEntries = useMemo(() => {
        const now = new Date()
        const NST_OFFSET_MS = (5 * 60 + 45) * 60 * 1000
        const nowNst = new Date(now.getTime() + NST_OFFSET_MS)

        // Reset hours for comparison boundaries in NST
        const startOfToday = new Date(nowNst.getFullYear(), nowNst.getMonth(), nowNst.getDate())
        
        const currentDay = nowNst.getDay() // 0 = Sunday, 1 = Monday, etc.
        const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay
        const startOfWeek = new Date(nowNst.getFullYear(), nowNst.getMonth(), nowNst.getDate() + diffToMonday)
        
        const startOfMonth = new Date(nowNst.getFullYear(), nowNst.getMonth(), 1)
        const startOfYear = new Date(nowNst.getFullYear(), 0, 1)

        const filterFn = (createdAtStr: string) => {
            const entryDate = new Date(createdAtStr)
            const entryDateNst = new Date(entryDate.getTime() + NST_OFFSET_MS)
            
            if (timeFilter === 'today') return entryDateNst >= startOfToday
            if (timeFilter === 'week') return entryDateNst >= startOfWeek
            if (timeFilter === 'month') return entryDateNst >= startOfMonth
            if (timeFilter === 'year') return entryDateNst >= startOfYear
            return true
        }

        return {
            income: incomeEntries.filter(e => filterFn(e.created_at)),
            expenses: expenses.filter(e => filterFn(e.created_at))
        }
    }, [incomeEntries, expenses, timeFilter])

    // Calculations
    const totalIncome = useMemo(() => {
        return timeFilteredEntries.income.reduce((sum, e) => sum + Number(e.amount), 0)
    }, [timeFilteredEntries.income])

    const totalExpense = useMemo(() => {
        return timeFilteredEntries.expenses.reduce((sum, e) => sum + Number(e.amount), 0)
    }, [timeFilteredEntries.expenses])

    const netCashflow = totalIncome - totalExpense

    // Categories list based on active quick-entry tab
    const currentCategories = activeTab === 'income' ? incomeCategories : expenseCategories

    // Add category handler
    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault()
        const name = newCatName.trim()
        if (!name) return

        setSubmittingCat(true)
        try {
            const res = await createCategoryAction(name, activeTab, newCatDesc)
            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                const newCat: Category = res.data
                if (activeTab === 'income') {
                    setIncomeCategories(prev => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)))
                } else {
                    setExpenseCategories(prev => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)))
                }
                setCategoryId(newCat.id)
                setNewCatName('')
                setNewCatDesc('')
                setShowNewCatForm(false)
                toast.success('Category created successfully!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create category')
        } finally {
            setSubmittingCat(false)
        }
    }

    // Add entry handler
    const handleAddEntry = async (e: React.FormEvent) => {
        e.preventDefault()
        const amt = parseFloat(amount)
        if (isNaN(amt) || amt <= 0) {
            toast.error('Amount must be a positive number')
            return
        }
        if (!categoryId) {
            toast.error('Please select a category')
            return
        }
        if (!description.trim()) {
            toast.error('Description is required')
            return
        }

        setSubmitting(true)
        try {
            const res = await createEntryAction({
                type: activeTab,
                category_id: categoryId,
                amount: amt,
                description: description.trim(),
                vendor_name: activeTab === 'expense' ? vendorName.trim() : undefined
            })

            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                if (activeTab === 'income') {
                    const newEntry: IncomeEntry = res.data
                    setIncomeEntries(prev => [newEntry, ...prev])
                    setListTab('income')
                } else {
                    const newEntry: ExpenseEntry = res.data
                    setExpenses(prev => [newEntry, ...prev])
                    setListTab('expense')
                }
                // Reset inputs
                setAmount('')
                setCategoryId('')
                setDescription('')
                setVendorName('')
                toast.success(`${activeTab === 'income' ? 'Income' : 'Expense'} logged successfully!`)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save entry')
        } finally {
            setSubmitting(false)
        }
    }

    // Delete entry handler
    const handleDeleteEntry = async (id: string, type: 'income' | 'expense') => {
        if (!confirm(`Are you sure you want to delete this ${type} entry?`)) return

        try {
            const res = await deleteEntryAction(id, type)
            if (res.error) {
                toast.error(res.error)
            } else {
                if (type === 'income') {
                    setIncomeEntries(prev => prev.filter(e => e.id !== id))
                } else {
                    setExpenses(prev => prev.filter(e => e.id !== id))
                }
                toast.success('Entry deleted')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete entry')
        }
    }

    // Delete category handler
    const handleDeleteCategory = async (id: string) => {
        const catList = activeTab === 'income' ? incomeCategories : expenseCategories
        const cat = catList.find(c => c.id === id)
        if (!cat) return

        if (!confirm(`Are you sure you want to delete the category "${cat.name}"?`)) return

        try {
            const res = await deleteCategoryAction(id, activeTab)
            if (res.error) {
                toast.error(res.error)
            } else {
                if (activeTab === 'income') {
                    setIncomeCategories(prev => prev.filter(c => c.id !== id))
                } else {
                    setExpenseCategories(prev => prev.filter(c => c.id !== id))
                }
                if (categoryId === id) setCategoryId('')
                toast.success('Category deleted')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete category')
        }
    }

    // Filtered entries
    const filteredIncomeEntries = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (!q) return timeFilteredEntries.income
        return timeFilteredEntries.income.filter(e =>
            e.description.toLowerCase().includes(q) ||
            e.income_categories?.name.toLowerCase().includes(q) ||
            String(e.amount).includes(q)
        )
    }, [timeFilteredEntries.income, searchQuery])

    const filteredExpenses = useMemo(() => {
        const q = searchQuery.toLowerCase().trim()
        if (!q) return timeFilteredEntries.expenses
        return timeFilteredEntries.expenses.filter(e =>
            e.description.toLowerCase().includes(q) ||
            e.expense_categories?.name.toLowerCase().includes(q) ||
            e.vendor_name?.toLowerCase().includes(q) ||
            String(e.amount).includes(q)
        )
    }, [timeFilteredEntries.expenses, searchQuery])

    return (
        <div className="space-y-6">
            {/* Page Title Header */}
            <div className="bg-surface p-5 md:p-6 rounded-[var(--r-md)] border border-hairline shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-extrabold text-ink">Income & Expenses</h1>
                        <p className="text-ink-subtle text-sm mt-1">
                            Track transactions manually. Accessible to all users.
                        </p>
                    </div>
                    {/* Time Filter Controls */}
                    <div className="flex flex-wrap gap-1.5 bg-surface-muted/40 p-1.5 border border-hairline rounded-xl">
                        {(['all', 'today', 'week', 'month', 'year'] as const).map(f => {
                            const labels = {
                                all: 'All Time',
                                today: 'Today',
                                week: 'This Week',
                                month: 'This Month',
                                year: 'This Year'
                            }
                            return (
                                <button
                                    key={f}
                                    type="button"
                                    onClick={() => setTimeFilter(f)}
                                    className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all focus-ring ${timeFilter === f ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-subtle hover:text-ink hover:bg-surface-muted'}`}
                                >
                                    {labels[f]}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            {/* Calculations Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface border border-hairline p-5 rounded-[var(--r-md)] shadow-sm relative overflow-hidden flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                        <TrendingUp size={24} />
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Income</p>
                        <p className="text-xl font-black text-emerald-600 mt-1">{formatCurrency(totalIncome)}</p>
                    </div>
                </div>

                <div className="bg-surface border border-hairline p-5 rounded-[var(--r-md)] shadow-sm relative overflow-hidden flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                        <TrendingDown size={24} />
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Expenses</p>
                        <p className="text-xl font-black text-rose-600 mt-1">{formatCurrency(totalExpense)}</p>
                    </div>
                </div>

                <div className="bg-surface border border-hairline p-5 rounded-[var(--r-md)] shadow-sm relative overflow-hidden flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${netCashflow >= 0 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-rose-50 text-rose-600 border-rose-100'}`}>
                        <ArrowRightLeft size={22} />
                    </div>
                    <div>
                        <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Net cashflow</p>
                        <p className={`text-xl font-black mt-1 ${netCashflow >= 0 ? 'text-amber-700' : 'text-rose-600'}`}>{formatCurrency(netCashflow)}</p>
                    </div>
                </div>
            </div>

            {/* Split Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                
                {/* Left Side - Quick Entry Form */}
                <div className="lg:col-span-4 bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm overflow-hidden">
                    <div className="border-b border-hairline bg-surface-muted/30 p-4">
                        <p className="text-sm font-black text-ink">Quick Record</p>
                    </div>

                    {/* Sliding Quick Entry Tabs */}
                    <div className="p-4 bg-surface border-b border-hairline flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setActiveTab('income'); setCategoryId(''); }}
                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${activeTab === 'income' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:text-ink hover:bg-surface-muted/50'}`}
                        >
                            Income
                        </button>
                        <button
                            type="button"
                            onClick={() => { setActiveTab('expense'); setCategoryId(''); }}
                            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider border rounded-lg transition-all focus-ring ${activeTab === 'expense' ? 'bg-rose-50 border-rose-200 text-rose-700 shadow-sm' : 'bg-surface border-hairline text-ink-subtle hover:text-ink hover:bg-surface-muted/50'}`}
                        >
                            Expense
                        </button>
                    </div>

                    <form onSubmit={handleAddEntry} className="p-4 space-y-4">
                        {/* Amount */}
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Amount (Rs.)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-subtle">Rs.</span>
                                <input
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                    required
                                    className="w-full pl-9 pr-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                />
                            </div>
                        </div>

                        {/* Category Selector with Inline Creation Button */}
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Category</label>
                                <button
                                    type="button"
                                    onClick={() => setShowNewCatForm(!showNewCatForm)}
                                    className="text-[10px] font-extrabold text-brand-600 hover:text-brand-700 flex items-center gap-1 focus-ring"
                                >
                                    {showNewCatForm ? <X size={10} /> : <Plus size={10} />}
                                    {showNewCatForm ? 'Cancel' : 'New Category'}
                                </button>
                            </div>

                            {/* Inline New Category Creation form */}
                            {showNewCatForm ? (
                                <div className="p-3 bg-surface-muted/30 border border-dashed border-hairline-strong rounded-xl mb-3 space-y-2">
                                    <input
                                        type="text"
                                        placeholder="Category Name"
                                        value={newCatName}
                                        onChange={e => setNewCatName(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                    <input
                                        type="text"
                                        placeholder="Description (Optional)"
                                        value={newCatDesc}
                                        onChange={e => setNewCatDesc(e.target.value)}
                                        className="w-full px-3 py-1.5 bg-surface border border-hairline rounded-lg text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddCategory}
                                        disabled={submittingCat || !newCatName.trim()}
                                        className="w-full py-1.5 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg text-xs font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-1"
                                    >
                                        {submittingCat ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                                        Save Category
                                    </button>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <select
                                        value={categoryId}
                                        onChange={e => setCategoryId(e.target.value)}
                                        required
                                        className="flex-1 px-3 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    >
                                        <option value="">Select Category</option>
                                        {currentCategories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name}</option>
                                        ))}
                                    </select>
                                    {categoryId && (
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteCategory(categoryId)}
                                            className="px-3 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 hover:border-rose-300 rounded-xl transition-colors focus-ring"
                                            title="Delete selected category"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Vendor (Expenses only) */}
                        {activeTab === 'expense' && (
                            <div>
                                <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Vendor Name (Optional)</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-subtle">
                                        <User size={14} />
                                    </span>
                                    <input
                                        type="text"
                                        placeholder="e.g. Electricity Office, Supplier"
                                        value={vendorName}
                                        onChange={e => setVendorName(e.target.value)}
                                        className="w-full pl-9 pr-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Description */}
                        <div>
                            <label className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">Description</label>
                            <textarea
                                placeholder="Details of this transaction..."
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                required
                                rows={3}
                                className="w-full px-4 py-2.5 bg-surface border border-hairline rounded-xl text-sm font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all resize-none"
                            />
                        </div>

                        {/* Submit Button */}
                        <button
                            type="submit"
                            disabled={submitting}
                            className={`w-full py-3 rounded-xl text-white font-black uppercase tracking-wider shadow-sm flex items-center justify-center gap-2 focus-ring transition-colors ${activeTab === 'income' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'} disabled:opacity-50`}
                        >
                            {submitting ? <Loader2 size={16} className="animate-spin" /> : activeTab === 'income' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                            Log {activeTab === 'income' ? 'Income' : 'Expense'}
                        </button>
                    </form>
                </div>

                {/* Right Side - Logs and History */}
                <div className="lg:col-span-8 bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm overflow-hidden flex flex-col">
                    <div className="border-b border-hairline bg-surface-muted/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <p className="text-sm font-black text-ink">Transaction Logs</p>

                        {/* Search Input */}
                        <div className="relative w-full sm:w-64">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
                                <Search size={14} />
                            </span>
                            <input
                                type="text"
                                placeholder="Search logs..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-1.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)]"
                            />
                        </div>
                    </div>

                    {/* Sliding List Tabs */}
                    <div className="border-b border-hairline px-4 bg-surface-muted/10 flex gap-4">
                        <button
                            type="button"
                            onClick={() => setListTab('income')}
                            className={`py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all relative ${listTab === 'income' ? 'border-emerald-600 text-emerald-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                        >
                            Income Log ({filteredIncomeEntries.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setListTab('expense')}
                            className={`py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all relative ${listTab === 'expense' ? 'border-rose-600 text-rose-600' : 'border-transparent text-ink-subtle hover:text-ink'}`}
                        >
                            Expense Log ({filteredExpenses.length})
                        </button>
                    </div>

                    {/* List Content */}
                    <div className="overflow-x-auto">
                        {listTab === 'income' ? (
                            filteredIncomeEntries.length === 0 ? (
                                <div className="text-center py-16 px-4">
                                    <FileText size={40} className="text-ink-subtle mx-auto mb-3 opacity-40" />
                                    <p className="text-sm font-bold text-ink-muted">No income entries found</p>
                                </div>
                            ) : (
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-surface-muted/20 border-b border-hairline">
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-12 text-center">#</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-28">Date</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-36">Category</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Description</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle text-right border-r border-hairline w-32">Amount</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle w-16 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {filteredIncomeEntries.map((item, idx) => (
                                            <tr key={item.id} className={`hover:bg-brand-50/5 transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/10'}`}>
                                                <td className="px-4 py-3 text-center border-r border-hairline font-black text-ink-muted">{idx + 1}</td>
                                                <td className="px-4 py-3 border-r border-hairline whitespace-nowrap text-ink-subtle font-bold">
                                                    {new Date(item.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase border border-emerald-100 bg-emerald-50 text-emerald-700">
                                                        {item.income_categories?.name || 'Uncategorized'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink">{item.description}</td>
                                                <td className="px-4 py-3 text-right font-black border-r border-hairline text-emerald-600 text-sm whitespace-nowrap">
                                                    {formatCurrency(item.amount)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => handleDeleteEntry(item.id, 'income')}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100 rounded-lg text-ink-subtle transition-all focus-ring"
                                                        title="Delete entry"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        ) : (
                            filteredExpenses.length === 0 ? (
                                <div className="text-center py-16 px-4">
                                    <FileText size={40} className="text-ink-subtle mx-auto mb-3 opacity-40" />
                                    <p className="text-sm font-bold text-ink-muted">No expense entries found</p>
                                </div>
                            ) : (
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-surface-muted/20 border-b border-hairline">
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-12 text-center">#</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-28">Date</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-36">Category</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-32">Vendor</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Description</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle text-right border-r border-hairline w-32">Amount</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle w-16 text-center">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {filteredExpenses.map((item, idx) => (
                                            <tr key={item.id} className={`hover:bg-brand-50/5 transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/10'}`}>
                                                <td className="px-4 py-3 text-center border-r border-hairline font-black text-ink-muted">{idx + 1}</td>
                                                <td className="px-4 py-3 border-r border-hairline whitespace-nowrap text-ink-subtle font-bold">
                                                    {new Date(item.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase border border-rose-100 bg-rose-50 text-rose-700">
                                                        {item.expense_categories?.name || 'Uncategorized'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink-subtle truncate max-w-[120px]" title={item.vendor_name || ''}>
                                                    {item.vendor_name || <span className="text-ink-muted italic">None</span>}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink">{item.description}</td>
                                                <td className="px-4 py-3 text-right font-black border-r border-hairline text-rose-600 text-sm whitespace-nowrap">
                                                    {formatCurrency(item.amount)}
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        onClick={() => handleDeleteEntry(item.id, 'expense')}
                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 border border-transparent hover:border-rose-100 rounded-lg text-ink-subtle transition-all focus-ring"
                                                        title="Delete entry"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}
