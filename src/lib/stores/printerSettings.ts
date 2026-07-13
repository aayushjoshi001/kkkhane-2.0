// lib/stores/printerSettings.ts
// Per-device thermal printer selection, persisted to localStorage.
//
// Deliberately NOT a restaurant_settings DB column: a printer is physically
// wired to one till/kitchen screen, so each device picks its own printer
// once. Read through useHydratedStore (see useHydratedStore.ts) to avoid
// SSR/client hydration mismatches, same as the cart store.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Only the kitchen/bar station tickets (KOT/BOT) use QZ Tray raw ESC/POS. The
// customer invoice is printed through the browser print dialog (the on-screen
// receipt is styled for an 80mm roll), so there is no invoice printer slot here.
interface PrinterSettingsState {
    kotPrinterName: string | null
    // Bar Order Ticket printer — the bar's counterpart to the KOT printer, so a
    // venue with a separate bar station can send drink tickets to its own roll.
    botPrinterName: string | null
    setKotPrinter: (name: string | null) => void
    setBotPrinter: (name: string | null) => void
}

export const usePrinterSettingsStore = create<PrinterSettingsState>()(
    persist(
        (set) => ({
            kotPrinterName: null,
            botPrinterName: null,
            setKotPrinter: (name) => set({ kotPrinterName: name }),
            setBotPrinter: (name) => set({ botPrinterName: name }),
        }),
        { name: 'srms-printer-settings' }
    )
)
