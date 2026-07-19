'use client'

import { useState } from 'react'
import { createPricingRuleAction, updatePricingRuleAction, deletePricingRuleAction } from './actions'
import { Plus, Trash2, Power, Pencil, CalendarClock, Search, Loader2 } from 'lucide-react'
import useSWR from 'swr'
import toast from 'react-hot-toast'
import { useCurrency, useDateFormatter } from '@/lib/contexts/FeatureContext'
import { fetchPricingRules } from '@/lib/swr-fetchers'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const RULE_TYPES = [
    { value: 'percentage_off', label: '% Off' },
    { value: 'fixed_price', label: 'Fixed Price' },
    { value: 'amount_off', label: 'Amount Off' },
]
type TargetType = 'all' | 'category' | 'item'

interface Rule {
    id: string
    name: string
    description: string | null
    rule_type: string
    value: number
    applies_to_item_id: string | null
    applies_to_category_id: string | null
    applies_to_all: boolean
    days_of_week: number[]
    start_time: string
    end_time: string
    valid_from: string | null
    valid_until: string | null
    is_active: boolean
    priority: number
    menu_items?: { name: string } | null
}

const EMPTY_FORM = {
    name: '',
    description: '',
    rule_type: 'percentage_off',
    value: '10',
    target_type: 'all' as TargetType,
    applies_to_item_id: '' as string,
    applies_to_category_id: '' as string,
    days_of_week: [] as number[],
    start_time: '11:00',
    end_time: '14:00',
    valid_from: '',
    valid_until: '',
    priority: '0',
}
type FormState = typeof EMPTY_FORM

const today = () => new Date().toISOString().slice(0, 10)

function ruleStatus(r: Rule): { label: string; cls: string } {
    if (!r.is_active) return { label: 'Inactive', cls: 'bg-surface-muted text-ink-subtle border border-hairline' }
    const d = today()
    if (r.valid_from && d < r.valid_from) return { label: 'Scheduled', cls: 'bg-brand-50 text-brand-600 border border-brand-100' }
    if (r.valid_until && d > r.valid_until) return { label: 'Expired', cls: 'bg-amber-50 text-amber-600 border border-amber-100' }
    return { label: 'Active', cls: 'bg-success-bg/50 text-success-fg border border-success-bg' }
}

const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function dateRangeLabel(from: string | null, until: string | null, fmt: (d: string) => string = fmtDate): string {
    if (from && until) return `${fmt(from)} – ${fmt(until)}`
    if (from) return `From ${fmt(from)}`
    if (until) return `Until ${fmt(until)}`
    return 'Always'
}

export default function PricingRulesManager({ initialRules, menuItems, categories, restaurantId }: {
    initialRules: Rule[]
    menuItems: { id: string; name: string }[]
    categories: { id: string; name: string }[]
    restaurantId: string
}) {
    const { data: rules = initialRules, mutate } = useSWR(['pricing_rules', restaurantId], () => fetchPricingRules(restaurantId), { fallbackData: initialRules })
    const money = useCurrency()
    const formatDate = useDateFormatter()
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    const [searchQuery, setSearchQuery] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')

    const filteredRules = rules.filter(r => {
        const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase())
        const matchesStatus = statusFilter === 'all' || 
                              (statusFilter === 'active' ? r.is_active : !r.is_active)
        return matchesSearch && matchesStatus
    })

    const categoryName = (id: string | null) => categories.find(c => c.id === id)?.name

    function appliesToLabel(r: Rule): string {
        if (r.applies_to_all) return 'All items'
        if (r.applies_to_category_id) return `Category: ${categoryName(r.applies_to_category_id) || '—'}`
        return r.menu_items?.name || '—'
    }

    function valueLabel(r: Rule): string {
        return r.rule_type === 'percentage_off' ? `${r.value}% off` : money(r.value)
    }

    function toggleDay(d: number) {
        setForm(prev => ({
            ...prev,
            days_of_week: prev.days_of_week.includes(d)
                ? prev.days_of_week.filter(x => x !== d)
                : [...prev.days_of_week, d].sort(),
        }))
    }

    function openCreate() {
        setEditingId(null)
        setForm(EMPTY_FORM)
        setShowForm(true)
    }

    function openEdit(r: Rule) {
        setEditingId(r.id)
        setForm({
            name: r.name,
            description: r.description || '',
            rule_type: r.rule_type,
            value: String(r.value),
            target_type: r.applies_to_all ? 'all' : r.applies_to_category_id ? 'category' : 'item',
            applies_to_item_id: r.applies_to_item_id || '',
            applies_to_category_id: r.applies_to_category_id || '',
            days_of_week: r.days_of_week || [],
            start_time: r.start_time?.slice(0, 5) || '11:00',
            end_time: r.end_time?.slice(0, 5) || '14:00',
            valid_from: r.valid_from || '',
            valid_until: r.valid_until || '',
            priority: String(r.priority ?? 0),
        })
        setShowForm(true)
    }

    function closeForm() {
        setShowForm(false)
        setEditingId(null)
        setForm(EMPTY_FORM)
    }

    /** Shared validation + payload assembly for create and edit. */
    function buildPayload(): {
        name: string; description: string | null; rule_type: string; value: number
        applies_to_all: boolean; applies_to_item_id: string | null; applies_to_category_id: string | null
        days_of_week: number[]; start_time: string; end_time: string
        valid_from: string | null; valid_until: string | null; priority: number
    } | null {
        if (!form.name.trim()) { toast.error('Rule name is required'); return null }
        const value = parseFloat(form.value)
        if (Number.isNaN(value) || value < 0) { toast.error('Enter a valid value'); return null }
        if (form.rule_type === 'percentage_off' && value > 100) { toast.error('Percentage cannot exceed 100'); return null }
        if (form.target_type === 'item' && !form.applies_to_item_id) { toast.error('Select a menu item'); return null }
        if (form.target_type === 'category' && !form.applies_to_category_id) { toast.error('Select a category'); return null }
        if (form.end_time <= form.start_time) { toast.error('End time must be after start time'); return null }
        if (form.valid_from && form.valid_until && form.valid_until < form.valid_from) {
            toast.error('“Valid until” must be on or after “valid from”'); return null
        }
        return {
            name: form.name.trim(),
            description: form.description.trim() || null,
            rule_type: form.rule_type,
            value,
            applies_to_all: form.target_type === 'all',
            applies_to_item_id: form.target_type === 'item' ? form.applies_to_item_id : null,
            applies_to_category_id: form.target_type === 'category' ? form.applies_to_category_id : null,
            days_of_week: form.days_of_week,
            start_time: form.start_time,
            end_time: form.end_time,
            valid_from: form.valid_from || null,
            valid_until: form.valid_until || null,
            priority: parseInt(form.priority) || 0,
        }
    }

    async function handleSave() {
        const payload = buildPayload()
        if (!payload) return
        setSaving(true)
        if (editingId) {
            const result = await updatePricingRuleAction(editingId, payload)
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            mutate()
            toast.success('Rule updated')
        } else {
            const result = await createPricingRuleAction({ restaurant_id: restaurantId, ...payload })
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            if (result.data) {
                const created: Rule = {
                    ...(result.data as Rule),
                    menu_items: payload.applies_to_item_id ? { name: menuItems.find(i => i.id === payload.applies_to_item_id)?.name || '' } : null,
                }
                mutate()
            }
            toast.success('Rule created')
        }
        closeForm()
    }

    async function toggleActive(rule: Rule) {
        const result = await updatePricingRuleAction(rule.id, { is_active: !rule.is_active })
        if (result.error) { toast.error(result.error); return }
        mutate()
    }

    async function handleDelete(id: string) {
        if (!confirm('Delete this pricing rule?')) return
        const result = await deletePricingRuleAction(id)
        if (result.error) { toast.error(result.error); return }
        mutate()
        toast.success('Deleted')
    }

    const valueHint = form.rule_type === 'percentage_off' ? '% off the base price'
        : form.rule_type === 'fixed_price' ? 'new price (Rs.)' : 'amount off (Rs.)'

    return (
        <div className="space-y-6">
            {/* Create / Edit Form */}
            {showForm ? (
                <div className="bg-surface rounded-card border border-hairline p-6 space-y-5 shadow-sm">
                    <h3 className="text-h3 text-ink">{editingId ? 'Edit Pricing Rule' : 'New Pricing Rule'}</h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <div className="lg:col-span-2">
                            <label className="block text-small font-bold text-ink mb-1.5">Rule Name</label>
                            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. Happy Hour 20% Off"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Priority</label>
                            <input type="number" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                            <p className="text-xs text-ink-subtle mt-1.5">Higher wins when rules overlap.</p>
                        </div>

                        <div className="lg:col-span-3">
                            <label className="block text-small font-bold text-ink mb-1.5">Description <span className="text-ink-subtle/70 font-normal">(optional)</span></label>
                            <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                                placeholder="Internal note about this rule"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all" />
                        </div>

                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Type</label>
                            <select value={form.rule_type} onChange={e => setForm({ ...form, rule_type: e.target.value })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all">
                                {RULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Value</label>
                            <input type="text" inputMode="decimal" value={form.value}
                                onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, value: v }) }}
                                placeholder="e.g. 10"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                            <p className="text-xs text-ink-subtle mt-1.5">{valueHint}</p>
                        </div>

                        {/* Target */}
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Applies To</label>
                            <select value={form.target_type} onChange={e => setForm({ ...form, target_type: e.target.value as TargetType })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all">
                                <option value="all">All items</option>
                                <option value="category">A category</option>
                                <option value="item">A specific item</option>
                            </select>
                        </div>
                        {form.target_type === 'category' && (
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Category</label>
                                <select value={form.applies_to_category_id} onChange={e => setForm({ ...form, applies_to_category_id: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all">
                                    <option value="">Select category…</option>
                                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                        {form.target_type === 'item' && (
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Menu Item</label>
                                <select value={form.applies_to_item_id} onChange={e => setForm({ ...form, applies_to_item_id: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all">
                                    <option value="">Select item…</option>
                                    {menuItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* Schedule: date range + time window */}
                    <div className="rounded-[var(--r-lg)] border border-hairline bg-surface-muted/30 p-5 space-y-5 shadow-inner">
                        <div className="flex items-center gap-2 text-sm font-bold text-ink">
                            <CalendarClock size={18} className="text-brand-500" /> Schedule
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Valid From <span className="text-ink-subtle/70 font-normal">(optional)</span></label>
                                <input type="date" value={form.valid_from} max={form.valid_until || undefined}
                                    onChange={e => setForm({ ...form, valid_from: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all" />
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Valid Until <span className="text-ink-subtle/70 font-normal">(optional)</span></label>
                                <input type="date" value={form.valid_until} min={form.valid_from || undefined}
                                    onChange={e => setForm({ ...form, valid_until: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all" />
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">Start Time</label>
                                <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                            </div>
                            <div>
                                <label className="block text-small font-bold text-ink mb-1.5">End Time</label>
                                <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                                    className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-2">Active Days <span className="text-ink-subtle/70 font-normal">(none = every day)</span></label>
                            <div className="flex flex-wrap gap-2">
                                {DAYS.map((label, i) => (
                                    <button key={i} type="button" onClick={() => toggleDay(i)}
                                        className={`px-4 py-2 rounded-[var(--r-md)] text-sm font-bold border transition-colors focus-ring ${form.days_of_week.includes(i) ? 'bg-ink text-surface border-ink' : 'bg-surface text-ink border-hairline hover:bg-surface-muted shadow-sm hover:shadow-md'}`}>
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 justify-end border-t border-hairline pt-6">
                        <button onClick={closeForm} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">Cancel</button>
                        <button onClick={handleSave} disabled={saving}
                            className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2 focus-ring">
                            {saving ? <Loader2 size={18} className="animate-spin" /> : (editingId ? <Pencil size={16} /> : <Plus size={16} />)}
                            {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Create Rule'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-surface p-5 rounded-card border border-hairline shadow-sm">
                    <div className="flex flex-1 gap-3 w-full sm:w-auto">
                        <div className="relative flex-1 sm:max-w-xs">
                            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                            <input
                                type="text"
                                placeholder="Search pricing rules..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-3 py-2.5 rounded-[var(--r-md)] border border-hairline text-sm focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all bg-surface shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]"
                            />
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm text-ink outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 w-36 shadow-sm transition-all"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>
                    <button onClick={openCreate}
                        className="flex items-center justify-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold w-full sm:w-auto shrink-0 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                        <Plus size={16} /> Add Rule
                    </button>
                </div>
            )}

            {/* Rules Table */}
            <div className="bg-surface rounded-card border border-hairline overflow-x-auto shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-surface-muted/50 text-ink-subtle uppercase tracking-wider text-[10px] font-bold border-b border-hairline">
                        <tr>
                            <th className="text-left px-5 py-4">Name</th>
                            <th className="text-right px-5 py-4">Adjustment</th>
                            <th className="text-left px-5 py-4 hidden md:table-cell">Applies To</th>
                            <th className="text-left px-5 py-4 hidden lg:table-cell">Date Range</th>
                            <th className="text-left px-5 py-4 hidden lg:table-cell">When</th>
                            <th className="text-center px-5 py-4 hidden sm:table-cell">Prio</th>
                            <th className="text-center px-5 py-4">Status</th>
                            <th className="text-right px-5 py-4">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {filteredRules.map(r => {
                            const status = ruleStatus(r)
                            return (
                                <tr key={r.id} className="hover:bg-surface-muted/30 transition-colors align-top">
                                    <td className="px-5 py-4">
                                        <div className="font-bold text-ink">{r.name}</div>
                                        {r.description && <div className="text-xs text-ink-subtle mt-1 max-w-xs truncate">{r.description}</div>}
                                    </td>
                                    <td className="px-5 py-4 text-right font-bold tabular-nums text-ink whitespace-nowrap">{valueLabel(r)}</td>
                                    <td className="px-5 py-4 text-ink-subtle hidden md:table-cell">{appliesToLabel(r)}</td>
                                    <td className="px-5 py-4 text-ink-subtle text-xs hidden lg:table-cell whitespace-nowrap">{dateRangeLabel(r.valid_from, r.valid_until, formatDate)}</td>
                                    <td className="px-5 py-4 text-ink-subtle text-xs hidden lg:table-cell whitespace-nowrap">
                                        <span className="font-medium">{(r.days_of_week?.length ? r.days_of_week.map((d: number) => DAYS[d]).join(', ') : 'All days')}</span>
                                        <br /><span className="tabular-nums">{r.start_time?.slice(0, 5)}–{r.end_time?.slice(0, 5)}</span>
                                    </td>
                                    <td className="px-5 py-4 text-center font-bold tabular-nums text-ink hidden sm:table-cell">{r.priority}</td>
                                    <td className="px-5 py-4 text-center">
                                        <button onClick={() => toggleActive(r)} className="inline-flex items-center gap-2 group focus-ring rounded-md p-1" title="Toggle active">
                                            <Power size={16} className={`transition-colors ${r.is_active ? 'text-success-fg' : 'text-ink-subtle'}`} />
                                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${status.cls}`}>{status.label}</span>
                                        </button>
                                    </td>
                                    <td className="px-5 py-4 text-right whitespace-nowrap">
                                        <button onClick={() => openEdit(r)} className="p-2 text-ink-subtle hover:text-ink hover:bg-surface-muted rounded-[var(--r-md)] transition-colors mr-1" title="Edit">
                                            <Pencil size={16} />
                                        </button>
                                        <button onClick={() => handleDelete(r.id)} className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] transition-colors" title="Delete">
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                        {filteredRules.length === 0 && (
                            <tr><td colSpan={8} className="px-5 py-12 text-center font-bold text-ink-subtle/70">No pricing rules found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
