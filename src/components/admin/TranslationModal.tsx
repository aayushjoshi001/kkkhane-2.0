'use client'

import { useState, useEffect } from 'react'
import { X, Loader2, Check, Globe } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { upsertTranslation } from '@/app/(admin)/admin/menu/translation-actions'

interface TranslationRow {
    language_code: string
    entity_type: string
    entity_id: string
    translated_text: string
}

interface Props {
    entityId: string
    entityType: 'menu_item' | 'category'
    englishName: string
    englishDescription?: string | null
    existingTranslations: TranslationRow[]
    onClose: () => void
}

export default function TranslationModal({
    entityId,
    entityType,
    englishName,
    englishDescription,
    existingTranslations,
    onClose,
}: Props) {
    const nameEntityType = entityType === 'menu_item' ? 'menu_item_name' : 'category_name'
    const descEntityType = 'menu_item_description'

    const initial = (type: string) =>
        existingTranslations.find(
            t => t.language_code === 'ne' && t.entity_type === type && t.entity_id === entityId
        )?.translated_text || ''

    const [nepaliName, setNepaliName] = useState(initial(nameEntityType))
    const [nepaliDesc, setNepaliDesc] = useState(initial(descEntityType))
    const [saving, setSaving] = useState(false)

    const [prevEntityId, setPrevEntityId] = useState(entityId)
    if (entityId !== prevEntityId) {
        setPrevEntityId(entityId)
        setNepaliName(initial(nameEntityType))
        setNepaliDesc(initial(descEntityType))
    }

    const handleSave = async () => {
        setSaving(true)
        const ops: Promise<{ success?: boolean; error?: string }>[] = []

        if (nepaliName.trim()) {
            ops.push(upsertTranslation(nameEntityType, entityId, 'ne', nepaliName.trim()))
        }
        if (entityType === 'menu_item' && nepaliDesc.trim()) {
            ops.push(upsertTranslation(descEntityType, entityId, 'ne', nepaliDesc.trim()))
        }

        const results = await Promise.all(ops)
        setSaving(false)

        const failed = results.find(r => r.error)
        if (failed) {
            toast.error(failed.error || 'Failed to save translations')
        } else {
            toast.success('Translations saved')
            onClose()
        }
    }

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-surface rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b border-hairline flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <Globe size={18} className="text-[var(--color-primary)]" />
                        <h3 className="font-semibold text-ink">Nepali Translation</h3>
                    </div>
                    <button onClick={onClose} className="text-ink-subtle hover:text-ink-muted">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div className="bg-surface-muted rounded-lg p-3 text-sm text-ink-muted border border-hairline">
                        <p className="font-medium text-ink-subtle text-xs uppercase tracking-wide mb-1">English</p>
                        <p className="font-semibold text-ink">{englishName}</p>
                        {englishDescription && (
                            <p className="text-ink-subtle mt-1 text-xs line-clamp-2">{englishDescription}</p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-ink-muted mb-1">
                            Name <span className="text-ink-subtle">(नेपाली)</span>
                        </label>
                        <input
                            type="text"
                            value={nepaliName}
                            onChange={e => setNepaliName(e.target.value)}
                            placeholder="नेपाली नाम"
                            className="w-full border border-hairline-strong rounded-lg p-2.5 text-sm focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                        />
                    </div>

                    {entityType === 'menu_item' && (
                        <div>
                            <label className="block text-sm font-medium text-ink-muted mb-1">
                                Description <span className="text-ink-subtle">(नेपाली)</span>
                            </label>
                            <textarea
                                value={nepaliDesc}
                                onChange={e => setNepaliDesc(e.target.value)}
                                placeholder="नेपाली विवरण (optional)"
                                rows={3}
                                className="w-full border border-hairline-strong rounded-lg p-2.5 text-sm resize-none focus:outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                            />
                        </div>
                    )}
                </div>

                <div className="px-6 py-4 bg-surface-muted border-t border-hairline flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface border border-hairline-strong rounded-lg hover:bg-surface-muted"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !nepaliName.trim()}
                        className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-primary)] rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                    >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                        Save Translation
                    </button>
                </div>
            </div>
        </div>
    )
}
