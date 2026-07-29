'use client'

import { type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'

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

/** Shared create/edit modal shell — a thin form-shaped wrapper over the Modal primitive. */
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
    return (
        <Modal open={open} onClose={onClose} size={maxWidth} ariaLabel={title}>
            <form onSubmit={onSubmit}>
                <div className="flex items-start justify-between gap-3 border-b border-hairline px-6 py-4">
                    <div>
                        <h3 className="text-lg font-black text-ink">{title}</h3>
                        {description && <p className="text-xs text-ink-subtle mt-0.5">{description}</p>}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
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
        </Modal>
    )
}
