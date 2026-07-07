'use client'

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

export interface FormModalProps {
    open: boolean
    onClose: () => void
    title: string
    description?: string
    onSubmit?: (e: FormEvent<HTMLFormElement>) => void
    submitLabel?: string
    submitting?: boolean
    submitDisabled?: boolean
    children: ReactNode
    maxWidth?: 'md' | 'lg' | 'xl'
}

const WIDTH: Record<NonNullable<FormModalProps['maxWidth']>, string> = {
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
}

/** Shared create/edit modal shell — replaces the inline overlay markup duplicated per admin feature. */
export default function FormModal({
    open,
    onClose,
    title,
    description,
    onSubmit,
    submitLabel = 'Save',
    submitting,
    submitDisabled,
    children,
    maxWidth = 'lg',
}: FormModalProps) {
    const [mounted, setMounted] = useState(false)
    useEffect(() => setMounted(true), [])
    if (!mounted || !open) return null

    return createPortal(
        <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className={cn(
                    'bg-surface w-full rounded-[28px] shadow-2xl border border-hairline max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-150',
                    WIDTH[maxWidth],
                )}
                onClick={(e) => e.stopPropagation()}
            >
                <form onSubmit={onSubmit}>
                    <div className="flex items-start justify-between gap-3 border-b border-hairline px-6 py-4">
                        <div>
                            <h3 className="text-lg font-black text-ink">{title}</h3>
                            {description && <p className="text-xs text-ink-subtle mt-0.5">{description}</p>}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center hover:bg-surface-muted transition text-ink-subtle hover:text-ink"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="px-6 py-5 space-y-4">{children}</div>
                    {onSubmit && (
                        <div className="flex items-center justify-end gap-2 border-t border-hairline px-6 py-4">
                            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
                            <Button type="submit" variant="primary" loading={submitting} disabled={submitDisabled}>{submitLabel}</Button>
                        </div>
                    )}
                </form>
            </div>
        </div>,
        document.body,
    )
}
