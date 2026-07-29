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
    /** True when the LAN printer failed and this device's own printer took the job. */
    usedLocalFallback?: boolean
}

function toConnStatus(result: QzResult): PrinterConnStatus {
    if (result.ok) return 'connected'
    return result.status === 'not-trusted' ? 'not-trusted' : 'not-running'
}

// How long a LAN target stays "known bad" after a failed send. Module-level, so
// every screen and both station slots share one view of a dead printer instead
// of each rediscovering it a ticket at a time.
const LAN_COOLDOWN_MS = 30_000
const lanFailedUntil = new Map<string, number>()
const lanKey = (t: { host: string; port: number }) => `${t.host}:${t.port}`

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
                const key = lanKey(networkPrinter.target)
                // Skip a LAN target that just failed and go straight to this
                // device's printer. Without this every ticket pays the connect
                // timeout again before falling back, which is what makes a
                // wrongly-configured LAN printer feel like printing is broken
                // rather than merely misrouted. One attempt per cooldown still
                // gets through, so the printer coming back is picked up on its
                // own without anyone restarting anything.
                const cooling = (lanFailedUntil.get(key) ?? 0) > Date.now()
                if (!(cooling && selectedPrinter)) {
                    const result = await printRawEscPos(networkPrinter.target, bytes, networkPrinter.copies)
                    if (result.ok) {
                        lanFailedUntil.delete(key)
                        setStatus(toConnStatus(result))
                        return result
                    }
                    lanFailedUntil.set(key, Date.now() + LAN_COOLDOWN_MS)
                    // A configured-but-unreachable LAN printer must not mean "no
                    // ticket at all". Both paths go through QZ Tray, so falling
                    // back only rescues an unreachable host: if QZ itself is
                    // down the local attempt fails the same way, and we return
                    // the original network failure so callers still see the LAN
                    // status they retry on.
                    if (!selectedPrinter) {
                        setStatus(toConnStatus(result))
                        return result
                    }
                    const local = await printRawEscPos(selectedPrinter, bytes)
                    setStatus(toConnStatus(local))
                    return local.ok ? { ...local, usedLocalFallback: true } : result
                }
                const local = await printRawEscPos(selectedPrinter as string, bytes)
                setStatus(toConnStatus(local))
                return local.ok ? { ...local, usedLocalFallback: true } : local
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
