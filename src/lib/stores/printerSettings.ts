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
    setInvoicePrinter: (name: string | null) => void
    setKotPrinter: (name: string | null) => void
}

export const usePrinterSettingsStore = create<PrinterSettingsState>()(
    persist(
        (set) => ({
            invoicePrinterName: null,
            kotPrinterName: null,
            setInvoicePrinter: (name) => set({ invoicePrinterName: name }),
            setKotPrinter: (name) => set({ kotPrinterName: name }),
        }),
        { name: 'srms-printer-settings' }
    )
)
