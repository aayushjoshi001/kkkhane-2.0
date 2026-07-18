'use client'

// Loads the restaurant's active printer config (the printers table) once in the
// browser and resolves an auto-print target by role. Unlike the per-device USB
// selection (printerSettings.ts, localStorage), this is restaurant-level: a LAN
// printer has one stable IP reachable from every screen, so it's configured
// once in Admin → Printers and every kitchen/till tab picks it up here.
//
// RLS (staff_read_printers) scopes the SELECT to the caller's restaurant, so we
// never pass a restaurant id — the query only ever returns this venue's rows.
import { useEffect } from 'react'
import { create } from 'zustand'
import { createClient } from '@/lib/supabase/client'
import type { Printer, PrinterConfigRole } from '@/types/database'

export interface ResolvedNetworkPrinter {
    target: { host: string; port: number }
    copies: number
}

interface NetworkPrintersState {
    printers: Printer[]
    loaded: boolean
    loading: boolean
    load: () => Promise<void>
    reload: () => Promise<void>
}

let inFlight: Promise<void> | null = null

export const useNetworkPrintersStore = create<NetworkPrintersState>((set, get) => ({
    printers: [],
    loaded: false,
    loading: false,
    load: async () => {
        if (get().loaded || get().loading) return
        if (inFlight) return inFlight
        set({ loading: true })
        inFlight = (async () => {
            try {
                const supabase = createClient()
                const { data } = await supabase
                    .from('printers')
                    .select('*')
                    .eq('printer_type', 'network')
                    .eq('is_active', true)
                set({ printers: (data as Printer[]) ?? [], loaded: true, loading: false })
            } catch {
                set({ printers: [], loaded: true, loading: false })
            } finally {
                inFlight = null
            }
        })()
        return inFlight
    },
    reload: async () => {
        set({ loaded: false, loading: false })
        inFlight = null
        return get().load()
    },
}))

// Prefer the role's explicit default, else the first active network printer for
// that role. Returns null when the venue hasn't configured a network printer —
// callers then fall back to the per-device USB selection.
export function resolveNetworkPrinter(printers: Printer[], role: PrinterConfigRole): ResolvedNetworkPrinter | null {
    const forRole = printers.filter((p) => p.role === role && p.ip_address)
    if (!forRole.length) return null
    const chosen = forRole.find((p) => p.is_default) ?? forRole[0]
    return {
        target: { host: chosen.ip_address as string, port: chosen.port || 9100 },
        copies: chosen.copies || 1,
    }
}

/** Ensures the config is loaded and resolves the network printer for a role. */
export function useNetworkPrinter(role: PrinterConfigRole): ResolvedNetworkPrinter | null {
    const printers = useNetworkPrintersStore((s) => s.printers)
    const load = useNetworkPrintersStore((s) => s.load)
    useEffect(() => { void load() }, [load])
    return resolveNetworkPrinter(printers, role)
}
