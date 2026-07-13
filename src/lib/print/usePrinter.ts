'use client'

import { useCallback, useState } from 'react'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { usePrinterSettingsStore } from '@/lib/stores/printerSettings'
import { listPrinters, printRawEscPos, type QzResult, type QzStatus } from './qzClient'

export type PrinterRole = 'kot' | 'bot'
export type PrinterConnStatus = 'idle' | 'connecting' | 'connected' | 'not-running' | 'not-trusted'

export interface PrintOutcome {
    ok: boolean
    status: QzStatus | 'no-printer-selected'
    error?: string
}

function toConnStatus(result: QzResult): PrinterConnStatus {
    if (result.ok) return 'connected'
    return result.status === 'not-trusted' ? 'not-trusted' : 'not-running'
}

/**
 * Per-role (KOT or BOT) station-printer connection + selection.
 * Printer choice is per-device (see printerSettings.ts) — this hook just
 * reads/writes the right slot for the given role and wraps the QZ Tray calls.
 */
export function usePrinter(role: PrinterRole) {
    const selectedPrinter = useHydratedStore(
        usePrinterSettingsStore,
        (s) => (role === 'bot' ? s.botPrinterName : s.kotPrinterName)
    )
    const setKotPrinter = usePrinterSettingsStore((s) => s.setKotPrinter)
    const setBotPrinter = usePrinterSettingsStore((s) => s.setBotPrinter)
    const selectPrinter = role === 'bot' ? setBotPrinter : setKotPrinter

    const [printers, setPrinters] = useState<string[]>([])
    const [status, setStatus] = useState<PrinterConnStatus>('idle')

    const refreshPrinters = useCallback(async () => {
        setStatus('connecting')
        try {
            const found = await listPrinters()
            setPrinters(found)
            setStatus('connected')
            return found
        } catch {
            setStatus('not-running')
            return []
        }
    }, [])

    const print = useCallback(
        async (bytes: Uint8Array): Promise<PrintOutcome> => {
            if (!selectedPrinter) {
                return { ok: false, status: 'no-printer-selected', error: 'No printer selected for this station — open Printer Settings.' }
            }
            const result = await printRawEscPos(selectedPrinter, bytes)
            setStatus(toConnStatus(result))
            return result
        },
        [selectedPrinter]
    )

    return { status, printers, refreshPrinters, print, selectedPrinter, selectPrinter }
}
