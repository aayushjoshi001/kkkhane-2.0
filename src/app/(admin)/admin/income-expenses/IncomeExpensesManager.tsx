'use client'

import { useState, useMemo, useRef } from 'react'
import {
    TrendingUp, TrendingDown, Plus, X,
    Search, Loader2, ArrowRightLeft, FileText, User,
    Download, Printer
} from 'lucide-react'
import { createCategoryAction, deleteCategoryAction, createEntryAction } from './actions'
import { toast } from 'react-hot-toast'
import { formatCurrency, parseExpenseDescription, orderCategoriesForDisplay, findMainCategory } from '@/lib/utils'
import { NST_OFFSET_MS } from '@/lib/timezone'
import { downloadCsv } from '@/lib/exportCsv'
import PrintableReport, { type PrintableReportHandle } from '@/components/admin/PrintableReport'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import { DateRangePicker, type DateRange } from '@/components/ui/DateRangePicker'

interface Category {
    id: string
    name: string
    description: string | null
    /** Only meaningful for expense categories — income_categories rows never have this set. */
    parent_id: string | null
}

interface BankAccount {
    id: string
    name: string
    bank_name: string | null
    account_number: string | null
}

interface IncomeEntry {
    id: string
    amount: number
    description: string
    created_at: string
    category_id: string
    income_categories: Category | null
    bank_accounts: BankAccount | null
    created_by_name?: string | null
}

interface ExpenseEntry {
    id: string
    amount: number
    description: string
    vendor_name: string | null
    created_at: string
    category_id: string
    expense_categories: Category | null
    bank_accounts: BankAccount | null
    created_by_name?: string | null
}
interface IncomeExpensesManagerProps {
    initialIncomeCategories: Category[]
    initialExpenseCategories: Category[]
    initialIncomeEntries: IncomeEntry[]
    initialExpenses: ExpenseEntry[]
    suppliers: Array<{ id: string; name: string }>
    bankAccounts: Array<{ id: string; name: string; bank_name: string | null; account_number: string | null }>
    qrCodes: Array<{ label: string; bank_account_id: string | null }>
}

export default function IncomeExpensesManager({
    initialIncomeCategories,
    initialExpenseCategories,
    initialIncomeEntries,
    initialExpenses,
    suppliers,
    bankAccounts,
    qrCodes
}: IncomeExpensesManagerProps) {
    const { confirm } = useConfirmStore()
    const formatDate = useDateFormatter()
    // Which QR code(s), if any, deposit into each bank account — lets staff
    // paying another party identify the right account by its QR instead of
    // just a bank name, when a restaurant runs more than one QR/bank pair.
    const qrLabelsByBank = useMemo(() => {
        const map = new Map<string, string[]>()
        for (const qr of qrCodes) {
            if (!qr.bank_account_id) continue
            const labels = map.get(qr.bank_account_id) ?? []
            labels.push(qr.label)
            map.set(qr.bank_account_id, labels)
        }
        return map
    }, [qrCodes])
    // Categories & Entries state
    const [incomeCategories, setIncomeCategories] = useState<Category[]>(initialIncomeCategories)
    const [expenseCategories, setExpenseCategories] = useState<Category[]>(initialExpenseCategories)
    const [incomeEntries, setIncomeEntries] = useState<IncomeEntry[]>(initialIncomeEntries)
    const [expenses, setExpenses] = useState<ExpenseEntry[]>(initialExpenses)

    // Form tab and inputs
    const [viewMode, setViewMode] = useState<'income' | 'expense'>('income')
    const activeTab = viewMode
    const [amount, setAmount] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [description, setDescription] = useState('')
    const [vendorSelection, setVendorSelection] = useState('')
    const [vendorName, setVendorName] = useState('')
    const [paymentSource, setPaymentSource] = useState<'cash' | 'bank'>('cash')
    const [bankName, setBankName] = useState('')
    const [submitting, setSubmitting] = useState(false)

    // Category modal/inline-editor
    const [showNewCatForm, setShowNewCatForm] = useState(false)
    const [newCatName, setNewCatName] = useState('')
    const [newCatDesc, setNewCatDesc] = useState('')
    const [newCatParentId, setNewCatParentId] = useState('')
    const [submittingCat, setSubmittingCat] = useState(false)

    // List tab and filters
    const listTab = viewMode
    const [searchQuery, setSearchQuery] = useState('')
    const [dateRange, setDateRange] = useState<DateRange>({ from: null, to: null })
    const [selectedIncomeCat, setSelectedIncomeCat] = useState<string>('all')
    const [selectedExpenseCat, setSelectedExpenseCat] = useState<string>('all')

    // Time-range filtered entries (aligned to Nepal Standard Time boundaries)
    const timeFilteredEntries = useMemo(() => {
        const filterFn = (createdAtStr: string) => {
            if (!dateRange.from && !dateRange.to) return true
            const entryDateNst = new Date(new Date(createdAtStr).getTime() + NST_OFFSET_MS).toISOString().slice(0, 10)
            if (dateRange.from && entryDateNst < dateRange.from) return false
            if (dateRange.to && entryDateNst > dateRange.to) return false
            return true
        }

        return {
            income: incomeEntries.filter(e => filterFn(e.created_at)),
            expenses: expenses.filter(e => filterFn(e.created_at))
        }
    }, [incomeEntries, expenses, dateRange])

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
    const currentCategoryOptions = useMemo(() => orderCategoriesForDisplay(currentCategories), [currentCategories])
    // Main (top-level) expense categories only — offered as the parent when
    // creating a new expense category. Income categories have no hierarchy.
    const mainExpenseCategories = useMemo(() => expenseCategories.filter(c => !c.parent_id), [expenseCategories])
    const incomeCategoryOptions = useMemo(() => orderCategoriesForDisplay(incomeCategories), [incomeCategories])
    const expenseCategoryOptions = useMemo(() => orderCategoriesForDisplay(expenseCategories), [expenseCategories])
    // Auto-identifies the main category once a subcategory is picked, e.g.
    // selecting "Vegetables" surfaces "Grocery" without the user needing to
    // know the hierarchy themselves.
    const selectedMainCategory = useMemo(() => findMainCategory(currentCategories, categoryId), [currentCategories, categoryId])

    // Add category handler
    const handleAddCategory = async (e: React.FormEvent) => {
        e.preventDefault()
        const name = newCatName.trim()
        if (!name) return

        setSubmittingCat(true)
        try {
            const res = await createCategoryAction(name, activeTab, newCatDesc, activeTab === 'expense' ? (newCatParentId || null) : undefined)
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
                setNewCatParentId('')
                setShowNewCatForm(false)
                toast.success('Category created successfully!')
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to create category')
        } finally {
            setSubmittingCat(false)
        }
    }

    // Auto-categorize based on description input
    const handleDescriptionBlur = () => {
        if (!description.trim()) return

        const query = description.toLowerCase().trim()
        const entries = activeTab === 'income' ? incomeEntries : expenses
        const categories = activeTab === 'income' ? incomeCategories : expenseCategories

        let guessedCatId: string | null = null

        // 1. Try to find a previous entry with the exact same description
        const exactMatch = entries.find(e => e.description.toLowerCase().trim() === query)
        if (exactMatch && exactMatch.category_id) {
            guessedCatId = exactMatch.category_id
        } else {
            // 2. Try to find a previous entry with partial/fuzzy match
            const partialMatch = entries.find(e => 
                e.description.toLowerCase().includes(query) || 
                query.includes(e.description.toLowerCase())
            )
            if (partialMatch && partialMatch.category_id) {
                guessedCatId = partialMatch.category_id
            }
        }

        // 3. Fall back to keyword mappings if no historical match is found
        if (!guessedCatId) {
            const keywords: Record<string, string[]> = {
                'food': ['chicken', 'vegetable', 'rice', 'oil', 'fish', 'meat', 'paneer', 'mutton', 'flour', 'sugar', 'salt', 'spice', 'potato', 'onion', 'milk', 'cheese', 'butter', 'egg', 'grocery', 'sauce', 'cream', 'spices', 'bread', 'yeast', 'bakery', 'tea', 'coffee'],
                'gas': ['gas', 'cylinder', 'lpg', 'fuel', 'petrol', 'diesel', 'kerosene'],
                'supplies': ['soap', 'shampoo', 'towel', 'tissue', 'cleaner', 'detergent', 'toilet', 'napkin', 'broom', 'mop', 'harpic', 'sanitizer', 'disinfectant'],
                'utilities': ['electricity', 'water', 'internet', 'wifi', 'phone', 'bill', 'electricity bill', 'water bill'],
                'salaries': ['salary', 'wage', 'payroll', 'salary payment', 'bonus', 'staff', 'salary staff'],
                'marketing': ['facebook', 'ads', 'marketing', 'poster', 'banner', 'flyer', 'ad'],
            }

            for (const [catName, words] of Object.entries(keywords)) {
                if (words.some(w => query.includes(w))) {
                    const matchedCat = categories.find(c => 
                        c.name.toLowerCase().includes(catName.toLowerCase()) || 
                        catName.toLowerCase().includes(c.name.toLowerCase())
                    )
                    if (matchedCat) {
                        guessedCatId = matchedCat.id
                        break
                    }
                }
            }
        }

        if (guessedCatId && guessedCatId !== categoryId) {
            const matchedCategory = categories.find(c => c.id === guessedCatId)
            if (matchedCategory) {
                setCategoryId(guessedCatId)
                toast.success(`Auto-selected category: ${matchedCategory.name}`, {
                    id: 'auto-category-toast'
                })
            }
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
        if (paymentSource === 'bank' && !bankName.trim()) {
            toast.error('Bank Name is required when payment source is Bank')
            return
        }

        const resolvedVendor = activeTab === 'expense'
            ? (vendorSelection === 'custom' ? vendorName.trim() : vendorSelection.trim())
            : undefined

        setSubmitting(true)
        try {
            const res = await createEntryAction({
                type: activeTab,
                category_id: categoryId,
                amount: amt,
                description: description.trim(),
                vendor_name: resolvedVendor || undefined,
                payment_source: paymentSource,
                bank_name: paymentSource === 'bank' ? bankName.trim() : undefined
            })

            if (res.error) {
                toast.error(res.error)
            } else if (res.data) {
                if (activeTab === 'income') {
                    const newEntry: IncomeEntry = res.data
                    setIncomeEntries(prev => [newEntry, ...prev])
                } else {
                    const newEntry: ExpenseEntry = res.data
                    setExpenses(prev => [newEntry, ...prev])
                }
                // Reset inputs
                setAmount('')
                setCategoryId('')
                setDescription('')
                setVendorName('')
                setVendorSelection('')
                setPaymentSource('cash')
                setBankName('')
                toast.success(`${activeTab === 'income' ? 'Income' : 'Expense'} logged successfully!`)
                if ('warning' in res && res.warning) toast.error(res.warning)
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to save entry')
        } finally {
            setSubmitting(false)
        }
    }

    // Delete category handler
    const handleDeleteCategory = async (id: string) => {
        const catList = activeTab === 'income' ? incomeCategories : expenseCategories
        const cat = catList.find(c => c.id === id)
        if (!cat) return

        const ok = await confirm({ title: `Are you sure you want to delete the category "${cat.name}"?`, message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return

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
        let items = timeFilteredEntries.income
        if (selectedIncomeCat !== 'all') {
            items = items.filter(e => e.category_id === selectedIncomeCat)
        }
        const q = searchQuery.toLowerCase().trim()
        if (!q) return items
        return items.filter(e =>
            e.description.toLowerCase().includes(q) ||
            e.income_categories?.name.toLowerCase().includes(q) ||
            String(e.amount).includes(q)
        )
    }, [timeFilteredEntries.income, searchQuery, selectedIncomeCat])

    const filteredExpenses = useMemo(() => {
        let items = timeFilteredEntries.expenses
        if (selectedExpenseCat !== 'all') {
            items = items.filter(e => e.category_id === selectedExpenseCat)
        }
        const q = searchQuery.toLowerCase().trim()
        if (!q) return items
        return items.filter(e =>
            e.description.toLowerCase().includes(q) ||
            e.expense_categories?.name.toLowerCase().includes(q) ||
            e.vendor_name?.toLowerCase().includes(q) ||
            String(e.amount).includes(q)
        )
    }, [timeFilteredEntries.expenses, searchQuery, selectedExpenseCat])

    const printRef = useRef<PrintableReportHandle>(null)
    const incomeReportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'category', label: 'Category' },
        { key: 'payment', label: 'Payment' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'by', label: 'Responsible Name' },
    ]
    const expenseReportColumns = [
        { key: 'date', label: 'Date', dateStacked: true },
        { key: 'category', label: 'Category' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'payment', label: 'Payment' },
        { key: 'description', label: 'Description' },
        { key: 'amount', label: 'Amount', align: 'right' as const },
        { key: 'by', label: 'Responsible Name' },
    ]
    const reportColumns = listTab === 'income' ? incomeReportColumns : expenseReportColumns
    const reportRows = listTab === 'income'
        ? filteredIncomeEntries.map(item => ({
            date: formatDate(item.created_at),
            category: item.income_categories?.name || 'Uncategorized',
            payment: item.bank_accounts ? item.bank_accounts.name : 'Cash',
            description: parseExpenseDescription(item.description).text_desc,
            amount: formatCurrency(item.amount),
            by: item.created_by_name || 'Unknown',
        }))
        : filteredExpenses.map(item => ({
            date: formatDate(item.created_at),
            category: item.expense_categories?.name || 'Uncategorized',
            vendor: item.vendor_name || '',
            payment: item.bank_accounts ? item.bank_accounts.name : 'Cash',
            description: parseExpenseDescription(item.description).text_desc,
            amount: formatCurrency(item.amount),
            by: item.created_by_name || 'Unknown',
        }))
    const handleExportCsv = () => downloadCsv(`${listTab}-log`, reportColumns, reportRows)

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
                    <DateRangePicker from={dateRange.from} to={dateRange.to} onChange={setDateRange} className="w-full sm:w-auto sm:max-w-xl" />
                </div>
            </div>

            {/* Huge Full-Width Switcher Tabs */}
            <div className="grid grid-cols-2 bg-surface border border-hairline rounded-[var(--r-md)] p-1.5 shadow-sm">
                <button
                    type="button"
                    onClick={() => { setViewMode('income'); setCategoryId(''); }}
                    className={`py-3.5 text-sm font-black uppercase tracking-wider rounded-lg transition-all focus-ring text-center ${viewMode === 'income' ? 'bg-emerald-600 text-white shadow-md' : 'text-ink-subtle hover:text-ink hover:bg-surface-muted/40'}`}
                >
                    Income
                </button>
                <button
                    type="button"
                    onClick={() => { setViewMode('expense'); setCategoryId(''); }}
                    className={`py-3.5 text-sm font-black uppercase tracking-wider rounded-lg transition-all focus-ring text-center ${viewMode === 'expense' ? 'bg-rose-600 text-white shadow-md' : 'text-ink-subtle hover:text-ink hover:bg-surface-muted/40'}`}
                >
                    Expense
                </button>
            </div>

            {/* Calculations Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {viewMode === 'income' ? (
                    <div className="bg-surface border border-hairline p-5 rounded-[var(--r-md)] shadow-sm relative overflow-hidden flex items-center gap-4 animate-in fade-in duration-200">
                        <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100 shrink-0">
                            <TrendingUp size={24} />
                        </div>
                        <div>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Income</p>
                            <p className="text-xl font-black text-emerald-600 mt-1">{formatCurrency(totalIncome)}</p>
                        </div>
                    </div>
                ) : (
                    <div className="bg-surface border border-hairline p-5 rounded-[var(--r-md)] shadow-sm relative overflow-hidden flex items-center gap-4 animate-in fade-in duration-200">
                        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center border border-rose-100 shrink-0">
                            <TrendingDown size={24} />
                        </div>
                        <div>
                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Total Expenses</p>
                            <p className="text-xl font-black text-rose-600 mt-1">{formatCurrency(totalExpense)}</p>
                        </div>
                    </div>
                )}

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
                
                {/* Transaction Logs and History */}
                <div className="lg:col-span-12 bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm overflow-hidden flex flex-col">
                    <div className="border-b border-hairline bg-surface-muted/30 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <p className="text-xs font-black uppercase tracking-wider text-ink">
                            TRANSACTION LOGS ({listTab === 'income' ? filteredIncomeEntries.length : filteredExpenses.length})
                        </p>

                        <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                            {/* Category Filter */}
                            {listTab === 'income' ? (
                                <Select
                                    value={selectedIncomeCat}
                                    onChange={e => setSelectedIncomeCat(e.target.value)}
                                    searchable
                                    className="px-3 py-1.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)] w-full sm:w-44"
                                >
                                    <option value="all">All Income Categories</option>
                                    {incomeCategoryOptions.map(({ category, label }) => (
                                        <option key={category.id} value={category.id}>{label}</option>
                                    ))}
                                </Select>
                            ) : (
                                <Select
                                    value={selectedExpenseCat}
                                    onChange={e => setSelectedExpenseCat(e.target.value)}
                                    searchable
                                    className="px-3 py-1.5 bg-surface border border-hairline rounded-xl text-xs font-bold text-ink focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_1px_2px_rgba(0,0,0,0.01)] w-full sm:w-44"
                                >
                                    <option value="all">All Expense Categories</option>
                                    {expenseCategoryOptions.map(({ category, label }) => (
                                        <option key={category.id} value={category.id}>{label}</option>
                                    ))}
                                </Select>
                            )}

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

                            {reportRows.length > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleExportCsv}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted/40 text-ink font-bold rounded-xl text-[10px] uppercase tracking-wider border border-hairline transition-all shrink-0"
                                    >
                                        <Download size={13} /> Export
                                    </button>
                                    <button
                                        onClick={() => printRef.current?.print()}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-surface-muted/40 text-ink font-bold rounded-xl text-[10px] uppercase tracking-wider border border-hairline transition-all shrink-0"
                                    >
                                        <Printer size={13} /> Print
                                    </button>
                                </div>
                            )}
                        </div>
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
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-28 font-bold">Payment</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Description</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle text-right border-r border-hairline w-32">Amount</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle w-32">Responsible Name</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {filteredIncomeEntries.map((item, idx) => (
                                            <tr key={item.id} className={`hover:bg-brand-50/5 transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/10'}`}>
                                                <td className="px-4 py-3 text-center border-r border-hairline font-black text-ink-muted">{idx + 1}</td>
                                                <td className="px-4 py-3 border-r border-hairline text-ink-subtle font-bold">
                                                    {formatDate(item.created_at)}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase border border-emerald-100 bg-emerald-50 text-emerald-700">
                                                        {item.income_categories?.name || 'Uncategorized'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase ${
                                                        item.bank_accounts ? 'bg-indigo-50 border border-indigo-100 text-indigo-700' : 'bg-amber-50 border border-amber-100 text-amber-700'
                                                    }`}>
                                                        {item.bank_accounts ? item.bank_accounts.name : 'Cash'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink">{parseExpenseDescription(item.description).text_desc}</td>
                                                <td className="px-4 py-3 text-right font-black border-r border-hairline text-emerald-600 text-sm whitespace-nowrap">
                                                    {formatCurrency(item.amount)}
                                                </td>
                                                <td className="px-4 py-3 font-bold text-ink">{item.created_by_name || 'Unknown'}</td>
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
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline w-28 font-bold">Payment</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle border-r border-hairline">Description</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle text-right border-r border-hairline w-32">Amount</th>
                                            <th className="px-4 py-3 font-bold text-ink-subtle w-32">Responsible Name</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-hairline">
                                        {filteredExpenses.map((item, idx) => (
                                            <tr key={item.id} className={`hover:bg-brand-50/5 transition-colors ${idx % 2 === 0 ? 'bg-surface' : 'bg-surface-muted/10'}`}>
                                                <td className="px-4 py-3 text-center border-r border-hairline font-black text-ink-muted">{idx + 1}</td>
                                                <td className="px-4 py-3 border-r border-hairline whitespace-nowrap text-ink-subtle font-bold">
                                                    {formatDate(item.created_at)}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className="inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase border border-rose-100 bg-rose-50 text-rose-700">
                                                        {item.expense_categories?.name || 'Uncategorized'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink-subtle truncate max-w-[120px]" title={item.vendor_name || ''}>
                                                    {item.vendor_name || <span className="text-ink-muted italic">None</span>}
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline">
                                                    <span className={`inline-flex px-2 py-0.5 rounded-[4px] text-[10px] font-black uppercase ${
                                                        item.bank_accounts ? 'bg-indigo-50 border border-indigo-100 text-indigo-700' : 'bg-amber-50 border border-amber-100 text-amber-700'
                                                    }`}>
                                                        {item.bank_accounts ? item.bank_accounts.name : 'Cash'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 border-r border-hairline font-bold text-ink">{parseExpenseDescription(item.description).text_desc}</td>
                                                <td className="px-4 py-3 text-right font-black border-r border-hairline text-rose-600 text-sm whitespace-nowrap">
                                                    {formatCurrency(item.amount)}
                                                </td>
                                                <td className="px-4 py-3 font-bold text-ink">{item.created_by_name || 'Unknown'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}
                    </div>
                </div>

            </div>

            <PrintableReport
                ref={printRef}
                title={listTab === 'income' ? 'Income Log' : 'Expense Log'}
                columns={reportColumns}
                rows={reportRows}
            />
        </div>
    )
}
