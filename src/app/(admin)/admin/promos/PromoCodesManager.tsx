'use client'

import { useState } from 'react'
import { createPromoCodeAction, updatePromoCodeAction, deletePromoCodeAction } from './actions'
import type { PromoCode } from '@/types/database'
import { Plus, Trash2, ToggleLeft, ToggleRight, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import useSWR from 'swr'
import { fetchPromoCodes } from '@/lib/swr-fetchers'
import { useConfirmStore } from '@/lib/stores/confirm'
import Select from '@/components/ui/Select'
import DateCell from '@/components/ui/DateCell'

const PROMO_TYPES = [
    { value: 'percentage_off', label: '% Off' },
    { value: 'amount_off', label: '$ Off' },
    { value: 'bogo', label: 'BOGO' },
    { value: 'free_item', label: 'Free Item' },
]

export default function PromoCodesManager({ initialPromos, restaurantId }: {
    initialPromos: PromoCode[]
    restaurantId: string
}) {
    const { confirm } = useConfirmStore()
    const { data: promos = initialPromos, mutate } = useSWR(['promo_codes', restaurantId], () => fetchPromoCodes(restaurantId), { fallbackData: initialPromos })
    const [showForm, setShowForm] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState({
        code: '', promo_type: 'percentage_off', value: '10',
        min_order_amount: '', max_discount_amount: '', max_uses: '', valid_until: '',
    })
    const [saving, setSaving] = useState(false)

    const emptyForm = { code: '', promo_type: 'percentage_off', value: '10', min_order_amount: '', max_discount_amount: '', max_uses: '', valid_until: '' }

    // Convert a stored ISO timestamp to the local `YYYY-MM-DDTHH:mm` that
    // <input type="datetime-local"> expects.
    function toLocalInput(iso: string | null): string {
        if (!iso) return ''
        const d = new Date(iso)
        if (Number.isNaN(d.getTime())) return ''
        const pad = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function openCreate() {
        setEditingId(null)
        setForm(emptyForm)
        setShowForm(true)
    }

    function openEdit(promo: PromoCode) {
        setEditingId(promo.id)
        setForm({
            code: promo.code,
            promo_type: promo.promo_type,
            value: String(promo.value),
            min_order_amount: promo.min_order_amount ? String(promo.min_order_amount) : '',
            max_discount_amount: promo.max_discount_amount != null ? String(promo.max_discount_amount) : '',
            max_uses: promo.max_uses != null ? String(promo.max_uses) : '',
            valid_until: toLocalInput(promo.valid_until),
        })
        setShowForm(true)
    }

    function closeForm() {
        setShowForm(false)
        setEditingId(null)
        setForm(emptyForm)
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)

        if (editingId) {
            const updates = {
                code: form.code,
                promo_type: form.promo_type,
                value: parseFloat(form.value) || 0,
                min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : 0,
                max_discount_amount: form.max_discount_amount ? parseFloat(form.max_discount_amount) : null,
                max_uses: form.max_uses ? parseInt(form.max_uses) : null,
                valid_until: form.valid_until || null,
            }
            const result = await updatePromoCodeAction(editingId, updates)
            setSaving(false)
            if (result.error) { toast.error(result.error); return }
            mutate()
            toast.success('Promo code updated')
            closeForm()
            return
        }

        const result = await createPromoCodeAction({
            restaurant_id: restaurantId,
            code: form.code,
            promo_type: form.promo_type,
            value: parseFloat(form.value) || 0,
            min_order_amount: form.min_order_amount ? parseFloat(form.min_order_amount) : undefined,
            max_discount_amount: form.max_discount_amount ? parseFloat(form.max_discount_amount) : undefined,
            max_uses: form.max_uses ? parseInt(form.max_uses) : undefined,
            valid_until: form.valid_until || undefined,
            is_active: true,
        })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        mutate()
        toast.success('Promo code created')
        closeForm()
    }

    async function toggleActive(promo: PromoCode) {
        const result = await updatePromoCodeAction(promo.id, { is_active: !promo.is_active })
        if (result.error) { toast.error(result.error); return }
        mutate()
    }

    async function handleDelete(id: string) {
        const ok = await confirm({ title: 'Delete this promo code?', message: 'This action cannot be undone.', confirmText: 'Delete', isDestructive: true })
        if (!ok) return
        const result = await deletePromoCodeAction(id)
        if (result.error) { toast.error(result.error); return }
        mutate()
        toast.success('Promo code deleted')
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <button onClick={openCreate} className="flex items-center gap-2 bg-brand-500 text-white px-5 py-2.5 rounded-[var(--r-md)] text-sm font-bold shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                    <Plus size={16} /> New Promo Code
                </button>
            </div>

            {showForm && (
                <form onSubmit={handleSubmit} className="bg-surface rounded-card border border-hairline p-6 space-y-6 shadow-sm">
                    <h2 className="text-h3 text-ink">{editingId ? 'Edit Promo Code' : 'New Promo Code'}</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Code *</label>
                            <input type="text" required value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all font-mono" placeholder="e.g. WELCOME20" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Type</label>
                            <Select value={form.promo_type} onChange={e => setForm({ ...form, promo_type: e.target.value })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all">
                                {PROMO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </Select>
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">
                                Value {form.promo_type === 'percentage_off' ? '(%)' : '($)'}
                            </label>
                            <input type="text" inputMode="decimal" required value={form.value}
                                onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, value: v }) }}
                                placeholder={form.promo_type === 'percentage_off' ? 'e.g. 10' : 'e.g. 5'}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Min Order ($)</label>
                            <input type="text" inputMode="decimal" value={form.min_order_amount}
                                onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, min_order_amount: v }) }}
                                placeholder="e.g. 500"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Max Discount ($)</label>
                            <input type="text" inputMode="decimal" value={form.max_discount_amount}
                                onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setForm({ ...form, max_discount_amount: v }) }}
                                placeholder="e.g. 200"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Max Uses (0 = unlimited)</label>
                            <input type="text" inputMode="numeric" value={form.max_uses}
                                onChange={e => { const v = e.target.value; if (/^\d*$/.test(v)) setForm({ ...form, max_uses: v }) }}
                                placeholder="Leave empty for unlimited"
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                        </div>
                        <div>
                            <label className="block text-small font-bold text-ink mb-1.5">Valid Until</label>
                            <input type="datetime-local" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })}
                                className="w-full border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all tabular-nums" />
                        </div>
                    </div>
                    <div className="flex gap-3 justify-end border-t border-hairline pt-6">
                        <button type="button" onClick={closeForm} className="px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:shadow-md transition-all focus-ring">Cancel</button>
                        <button type="submit" disabled={saving} className="px-5 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none focus-ring">
                            {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Code'}
                        </button>
                    </div>
                </form>
            )}

            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-sm">
                {/* Horizontal scroll: the card around this clips with
                    overflow-hidden, so on a narrow screen the right-hand
                    columns were cut off with no way to reach them. */}
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-ink-subtle uppercase tracking-wider text-[10px] font-bold border-b border-hairline">
                            <tr>
                                <th className="text-left px-5 py-4">Code</th>
                                <th className="text-left px-5 py-4">Type</th>
                                <th className="text-left px-5 py-4">Value</th>
                                <th className="text-left px-5 py-4 hidden md:table-cell">Uses</th>
                                <th className="text-left px-5 py-4 hidden md:table-cell">Expires</th>
                                <th className="text-left px-5 py-4">Status</th>
                                <th className="text-right px-5 py-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {promos.map(promo => (
                                <tr key={promo.id} className="hover:bg-surface-muted/30 transition-colors">
                                    <td className="px-5 py-4 font-mono font-bold text-ink tracking-wide">{promo.code}</td>
                                    <td className="px-5 py-4 capitalize text-ink-subtle">{promo.promo_type.replace('_', ' ')}</td>
                                    <td className="px-5 py-4 font-bold tabular-nums text-ink">{promo.promo_type === 'percentage_off' ? `${promo.value}%` : `$${promo.value}`}</td>
                                    <td className="px-5 py-4 text-ink-subtle font-medium tabular-nums hidden md:table-cell">{promo.current_uses} / {promo.max_uses || '∞'}</td>
                                    <td className="px-5 py-4 text-ink-subtle hidden md:table-cell">{promo.valid_until ? <DateCell value={promo.valid_until} /> : '—'}</td>
                                    <td className="px-5 py-4">
                                        <label className="relative inline-flex items-center cursor-pointer group">
                                            <input 
                                                type="checkbox" 
                                                className="sr-only peer" 
                                                checked={promo.is_active} 
                                                onChange={() => toggleActive(promo)}
                                            />
                                            <div className="w-11 h-6 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-shadow"></div>
                                        </label>
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <div className="flex gap-1.5 justify-end">
                                            <button onClick={() => openEdit(promo)} className="p-2 text-ink-subtle hover:text-ink hover:bg-surface-muted rounded-[var(--r-md)] transition-colors" title="Edit promo code">
                                                <Pencil size={16} />
                                            </button>
                                            <button onClick={() => handleDelete(promo.id)} className="p-2 text-ink-subtle hover:text-danger-fg hover:bg-danger-bg rounded-[var(--r-md)] transition-colors" title="Delete promo code">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {promos.length === 0 && (
                                <tr><td colSpan={7} className="px-5 py-12 text-center font-bold text-ink-subtle/70">No promo codes yet. Create your first one!</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
