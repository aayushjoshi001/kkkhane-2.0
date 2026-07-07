'use client'

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { PrinterSettingsModal } from './PrinterSettingsModal'
import type { PrinterRole } from '@/lib/print/usePrinter'

interface Props {
    role: PrinterRole
    /** 'dark' for kitchen header (white text), 'light' for waiter/cashier header */
    variant?: 'dark' | 'light'
    className?: string
}

export default function PrinterSettingsButton({ role, variant = 'light', className = '' }: Props) {
    const [open, setOpen] = useState(false)

    const darkStyles = 'text-white/80 bg-white/10 border-white/15 hover:bg-white/20'
    const lightStyles = 'text-ink-subtle bg-surface-muted border-hairline hover:bg-surface'

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className={`flex items-center justify-center w-10 h-10 rounded-full border transition ${variant === 'dark' ? darkStyles : lightStyles} ${className}`}
                title="Printer settings"
                aria-label="Printer settings"
            >
                <Printer size={18} />
            </button>
            <PrinterSettingsModal role={role} open={open} onClose={() => setOpen(false)} />
        </>
    )
}
