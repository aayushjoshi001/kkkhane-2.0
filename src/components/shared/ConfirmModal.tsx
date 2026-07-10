'use client'

import { useConfirmStore } from '@/lib/stores/confirm'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'

export function ConfirmModal() {
    const { isOpen, title, message, confirmText, cancelText, isDestructive, handleConfirm, handleCancel } = useConfirmStore()

    return (
        <Modal
            open={isOpen}
            onClose={handleCancel}
            size="sm"
            layer="top"
            ariaLabel={title}
        >
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-full ${isDestructive ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                            {isDestructive ? <AlertCircle size={20} /> : <CheckCircle2 size={20} />}
                        </div>
                        <div className="flex-1 mt-0.5">
                            <h3 className="text-lg font-semibold text-ink leading-tight">
                                {title}
                            </h3>
                            <p className="mt-2 text-sm text-ink-subtle leading-relaxed">
                                {message}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 bg-surface-muted border-t border-hairline flex justify-end gap-3 sm:rounded-b-[24px]">
                    <button
                        onClick={handleCancel}
                        className="px-4 py-2 text-sm font-medium text-ink-muted bg-surface border border-hairline-strong rounded-lg shadow-sm hover:bg-surface-muted transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]/50"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={handleConfirm}
                        className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${isDestructive
                                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500/50'
                                : 'bg-[var(--color-primary)] hover:opacity-90 focus:ring-[var(--color-primary)]/50'
                            }`}
                    >
                        {confirmText}
                    </button>
                </div>
        </Modal>
    )
}
