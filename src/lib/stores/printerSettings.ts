// lib/stores/printerSettings.ts
// Per-device thermal printer selection, persisted to localStorage.
//
// Deliberately NOT a restaurant_settings DB column: a printer is physically
// wired to one till/kitchen screen, so each device picks its own printer
// once. Read through useHydratedStore (see useHydratedStore.ts) to avoid
// SSR/client hydration mismatches, same as the cart store.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface PrinterSettingsState {
    invoicePrinterName: string | null
    kotPrinterName: string | null
    // Bar Order Ticket printer — the bar's counterpart to the KOT printer, so a
    // venue with a separate bar station can send drink tickets to its own roll.
    botPrinterName: string | null
    setInvoicePrinter: (name: string | null) => void
    setKotPrinter: (name: string | null) => void
    setBotPrinter: (name: string | null) => void
}

export const usePrinterSettingsStore = create<PrinterSettingsState>()(
    persist(
        (set) => ({
            invoicePrinterName: null,
            kotPrinterName: null,
            botPrinterName: null,
            setInvoicePrinter: (name) => set({ invoicePrinterName: name }),
            setKotPrinter: (name) => set({ kotPrinterName: name }),
            setBotPrinter: (name) => set({ botPrinterName: name }),
        }),
        { name: 'srms-printer-settings' }
    )
)
