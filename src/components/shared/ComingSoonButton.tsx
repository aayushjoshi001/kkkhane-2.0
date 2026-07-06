'use client'

import { useState } from 'react'
import { Hammer, X } from 'lucide-react'

interface ComingSoonButtonProps {
    /** Visual content of the button (icons, labels). */
    children: React.ReactNode
    /** Classes applied to the button so it matches the surrounding design. */
    className?: string
    /** Name of the feature, shown in the modal message. */
    feature?: string
}

/**
 * A button that looks like a real action but, when clicked, opens a modal
 * explaining the feature is still under development. Use for placeholder
 * actions (social login, app store links, etc.).
 */
export default function ComingSoonButton({ children, className = '', feature = 'This feature' }: ComingSoonButtonProps) {
    const [open, setOpen] = useState(false)

    return (
        <>
            <button type="button" className={className} onClick={() => setOpen(true)}>
                {children}
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setOpen(false)}
                >
                    <div
                        className="relative bg-surface rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-hairline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setOpen(false)}
                            className="absolute top-3 right-3 text-ink-subtle hover:text-ink-muted transition-colors"
                            aria-label="Close"
                        >
                            <X size={18} />
                        </button>

                        <div className="p-6 text-center">
                            <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600 mb-4">
                                <Hammer size={26} />
                            </div>
                            <h3 className="text-lg font-semibold text-ink leading-tight">
                                Under development
                            </h3>
                            <p className="mt-2 text-sm text-ink-subtle leading-relaxed">
                                {feature} is still being built. We&apos;re working hard to bring it to you soon — thanks for your patience!
                            </p>
                            <button
                                onClick={() => setOpen(false)}
                                className="mt-5 w-full px-4 py-2.5 text-sm font-semibold text-white bg-[var(--color-primary)] rounded-lg shadow-sm hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--color-primary)]/50"
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    )
}
