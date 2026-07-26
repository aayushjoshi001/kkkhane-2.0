'use client'

import { useState, useEffect } from 'react'
import { Megaphone, Plus, Trash2, Edit3, Save, X, Loader2, ArrowRight } from 'lucide-react'
import { getSystemAdvertisementsAction, saveSystemAdvertisementAction, deleteSystemAdvertisementAction } from '../actions'
import toast from 'react-hot-toast'

interface Ad {
    id?: string
    badge: string
    title: string
    description: string
    cta: string
    link: string
}

export default function AdManager() {
    const [ads, setAds] = useState<Ad[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form, setForm] = useState<Ad>({ badge: '', title: '', description: '', cta: '', link: '' })
    const [showForm, setShowForm] = useState(false)

    useEffect(() => {
        loadAds()
    }, [])

    async function loadAds() {
        setLoading(true)
        try {
            const res = await getSystemAdvertisementsAction()
            if (res.data) setAds(res.data)
        } catch (e) {
            toast.error('Failed to load advertisements')
        } finally {
            setLoading(false)
        }
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault()
        if (!form.badge.trim() || !form.title.trim() || !form.description.trim() || !form.cta.trim() || !form.link.trim()) {
            toast.error('All fields are required')
            return
        }

        setSaving(true)
        try {
            const res = await saveSystemAdvertisementAction(form)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success(form.id ? 'Advertisement updated!' : 'Advertisement added!')
                setForm({ badge: '', title: '', description: '', cta: '', link: '' })
                setEditingId(null)
                setShowForm(false)
                loadAds()
            }
        } catch (e) {
            toast.error('An error occurred while saving')
        } finally {
            setSaving(false)
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this advertisement?')) return
        try {
            const res = await deleteSystemAdvertisementAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Advertisement deleted!')
                loadAds()
            }
        } catch (e) {
            toast.error('Failed to delete')
        }
    }

    function handleStartEdit(ad: Ad) {
        setForm(ad)
        setEditingId(ad.id || null)
        setShowForm(true)
    }

    return (
        <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up">
            <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Megaphone size={18} className="text-brand-500" />
                    <div>
                        <h2 className="font-semibold text-ink">Dashboard Sponsored Advertisements</h2>
                        <p className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Manage global system announcement banners</p>
                    </div>
                </div>
                {!showForm && (
                    <button
                        onClick={() => {
                            setForm({ badge: '', title: '', description: '', cta: '', link: '' })
                            setEditingId(null)
                            setShowForm(true)
                        }}
                        className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-all active:scale-95"
                    >
                        <Plus size={14} /> Add Banner
                    </button>
                )}
            </div>

            {showForm && (
                <form onSubmit={handleSave} className="p-6 border-b border-hairline bg-surface-muted/10 space-y-4">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-bold text-ink">{editingId ? 'Edit Advertisement' : 'Create New Advertisement'}</h3>
                        <button
                            type="button"
                            onClick={() => {
                                setShowForm(false)
                                setEditingId(null)
                            }}
                            className="p-1 hover:bg-surface-muted rounded-lg text-ink-subtle hover:text-ink transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-ink-subtle uppercase">Badge (e.g. NEW INTEGRATION)</label>
                            <input
                                type="text"
                                placeholder="Badge label"
                                value={form.badge}
                                onChange={e => setForm(prev => ({ ...prev, badge: e.target.value }))}
                                className="w-full h-10 px-3 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand-500"
                                required
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-ink-subtle uppercase">Action Button Text (e.g. Connect Channels)</label>
                            <input
                                type="text"
                                placeholder="CTA button text"
                                value={form.cta}
                                onChange={e => setForm(prev => ({ ...prev, cta: e.target.value }))}
                                className="w-full h-10 px-3 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand-500"
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-ink-subtle uppercase">Headline Title</label>
                        <input
                            type="text"
                            placeholder="Ad Title"
                            value={form.title}
                            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                            className="w-full h-10 px-3 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand-500"
                            required
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-ink-subtle uppercase">Description</label>
                        <textarea
                            placeholder="Enter announcement details..."
                            value={form.description}
                            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                            rows={3}
                            className="w-full p-3 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand-500"
                            required
                        />
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-bold text-ink-subtle uppercase">Action Link / Route</label>
                        <input
                            type="text"
                            placeholder="/admin/settings or external URL"
                            value={form.link}
                            onChange={e => setForm(prev => ({ ...prev, link: e.target.value }))}
                            className="w-full h-10 px-3 bg-surface border border-hairline rounded-xl text-xs font-semibold text-ink focus:outline-none focus:border-brand-500"
                            required
                        />
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => {
                                setShowForm(false)
                                setEditingId(null)
                            }}
                            className="px-4 py-2 text-xs font-bold text-ink-subtle hover:bg-surface-muted rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex items-center gap-1.5 px-5 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs shadow-sm transition-all"
                        >
                            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                            {editingId ? 'Update Banner' : 'Create Banner'}
                        </button>
                    </div>
                </form>
            )}

            <div className="p-6">
                {loading ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 size={24} className="animate-spin text-brand-500" />
                    </div>
                ) : ads.length === 0 ? (
                    <p className="text-xs text-ink-subtle font-bold italic text-center py-6">No custom advertisements. Showing defaults.</p>
                ) : (
                    <div className="space-y-4">
                        {ads.map(ad => (
                            <div key={ad.id} className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 border border-hairline rounded-2xl bg-surface-muted/30">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100">
                                            {ad.badge}
                                        </span>
                                    </div>
                                    <h4 className="text-sm font-extrabold text-ink">{ad.title}</h4>
                                    <p className="text-xs text-ink-subtle max-w-2xl">{ad.description}</p>
                                    <p className="text-[10px] font-bold text-ink-muted">Link: <span className="font-mono">{ad.link}</span></p>
                                </div>
                                <div className="flex items-center gap-2 self-end md:self-center shrink-0">
                                    <button
                                        onClick={() => handleStartEdit(ad)}
                                        className="p-2 bg-surface hover:bg-surface-muted text-ink border border-hairline rounded-xl transition-all"
                                        title="Edit"
                                    >
                                        <Edit3 size={14} />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(ad.id!)}
                                        className="p-2 bg-surface hover:bg-red-50 text-rose-600 border border-hairline hover:border-red-200 rounded-xl transition-all"
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
