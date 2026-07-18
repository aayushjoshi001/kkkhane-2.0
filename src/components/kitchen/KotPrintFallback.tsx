'use client'

import { useEffect } from 'react'
import type { KitchenOrder } from './OrderQueue'
import { STATION_META, type StationKind } from '@/lib/stations'
import { getKOTSourceLabel, getItemKOTDisplay } from '@/lib/utils'

/**
 * Browser-print fallback for a station ticket (KOT or BOT) when QZ Tray isn't
 * connected/trusted on this device. Sits off-screen normally; the @media print
 * rules (same visibility-isolation technique as the invoice receipt in
 * CashierClient.tsx) make it the only thing that prints when window.print()
 * fires. The order passed in is already projected to this station's lines.
 */
export default function KotPrintFallback({ order, station = 'kitchen', onDone }: { order: KitchenOrder | null; station?: StationKind; onDone: () => void }) {
    useEffect(() => {
        if (!order) return
        const timer = setTimeout(() => window.print(), 50)
        const handleAfterPrint = () => onDone()
        window.addEventListener('afterprint', handleAfterPrint)
        return () => {
            clearTimeout(timer)
            window.removeEventListener('afterprint', handleAfterPrint)
        }
    }, [order, onDone])

    if (!order) return null

    const sourceLabel = getKOTSourceLabel(order).toUpperCase()

    return (
        <div className="kot-print-container fixed" style={{ left: -10000, top: 0 }}>
            <style>{`
                @page { size: 80mm auto; margin: 0; }
                @media print {
                    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                    body * { visibility: hidden !important; }
                    .kot-print-container, .kot-print-container * { visibility: visible !important; }
                    .kot-print-container {
                        position: absolute !important; left: 0 !important; top: 0 !important;
                        width: 72mm !important; max-width: 72mm !important;
                        font-family: monospace !important; font-size: 12px !important; line-height: 1.35 !important;
                        color: #000 !important; background: #fff !important; padding: 2mm 0 4mm 0 !important;
                    }
                }
            `}</style>
            <div className="text-center font-black uppercase text-[11px]">{STATION_META[station].ticketTitle}</div>
            <div className="border-t border-dashed border-black my-1" />
            <div className="text-center font-black text-sm">{sourceLabel}</div>
            <div className="text-[10px]">Order: #{order.id.slice(0, 8).toUpperCase()}</div>
            <div className="text-[10px]">Time: {new Date(order.placed_at).toLocaleTimeString()}</div>
            <div className="border-t border-dashed border-black my-1" />
            {(order.order_items || []).map((item) => {
                const { name, note } = getItemKOTDisplay(item, order.order_type)
                return (
                    <div key={item.id} className="mb-1">
                        <div className="font-bold text-[11px]">{item.quantity} x {name}</div>
                        {note && <div className="pl-3 text-[10px]">Note: {note}</div>}
                        {(item.order_item_modifiers || []).map((mod, i) =>
                            mod.modifier_name ? <div key={i} className="pl-3 text-[10px]">+ {mod.modifier_name}</div> : null
                        )}
                    </div>
                )
            })}
            {order.customer_note && (
                <>
                    <div className="border-t border-dashed border-black my-1" />
                    <div className="text-[10px]">Order note: {order.customer_note}</div>
                </>
            )}
        </div>
    )
}
