'use client'

import { useCallback, useState } from 'react'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { usePrinterSettingsStore } from '@/lib/stores/printerSettings'
import { listPrinters, printRawEscPos, type QzResult, type QzStatus } from './qzClient'
import { useNetworkPrinter } from './useNetworkPrinters'
import type { PrinterConfigRole } from '@/types/database'

export type PrinterRole = 'invoice' | 'kot' | 'bot'

// The invoice slot prints the customer bill, which the printers table calls 'bill'.
const CONFIG_ROLE: Record<PrinterRole, PrinterConfigRole> = { invoice: 'bill', kot: 'kot', bot: 'bot' }
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
 * Per-role (invoice or KOT) printer connection + selection.
 * Printer choice is per-device (see printerSettings.ts) — this hook just
 * reads/writes the right slot for the given role and wraps the QZ Tray calls.
 *
 * The invoice role falls back to the KOT printer when no dedicated invoice
 * printer is set, so a single-printer till (one thermal roll for everything)
 * works after configuring just one slot — the cashier doesn't have to pick the
 * same printer twice. An explicit invoice-printer choice still takes priority.
 */
export function usePrinter(role: PrinterRole) {
    const selectedPrinter = useHydratedStore(
        usePrinterSettingsStore,
        (s) => (role === 'invoice' ? (s.invoicePrinterName ?? s.kotPrinterName) : role === 'bot' ? s.botPrinterName : s.kotPrinterName)
    )
    const setInvoicePrinter = usePrinterSettingsStore((s) => s.setInvoicePrinter)
    const setKotPrinter = usePrinterSettingsStore((s) => s.setKotPrinter)
    const setBotPrinter = usePrinterSettingsStore((s) => s.setBotPrinter)
    const selectPrinter = role === 'invoice' ? setInvoicePrinter : role === 'bot' ? setBotPrinter : setKotPrinter

    // A restaurant-level network printer (Admin → Printers) wins over the
    // per-device USB pick: it's the shared LAN target every screen prints to.
    const networkPrinter = useNetworkPrinter(CONFIG_ROLE[role])

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
            if (networkPrinter) {
                const result = await printRawEscPos(networkPrinter.target, bytes, networkPrinter.copies)
                setStatus(toConnStatus(result))
                return result
            }
            if (!selectedPrinter) {
                return { ok: false, status: 'no-printer-selected', error: 'No printer selected for this station — open Printer Settings.' }
            }
            const result = await printRawEscPos(selectedPrinter, bytes)
            setStatus(toConnStatus(result))
            return result
        },
        [selectedPrinter, networkPrinter]
    )

    // True when auto-print has a destination — either a LAN printer or a USB pick.
    const hasTarget = !!networkPrinter || !!selectedPrinter

    return { status, printers, refreshPrinters, print, selectedPrinter, selectPrinter, hasTarget, networkPrinter }
}
