// lib/invoiceNumber.ts
// Calls the database's next_invoice_number(p_restaurant_id) function.
// That function atomically increments a per-restaurant, per-fiscal-year counter
// (Nepal fiscal year: Shrawan 1 → Ashadh 31) and returns a string like
// "INV-2082/83-000042".
//
// WHY: Previously every checkout route built its own ad-hoc string from UUIDs
// (e.g. "INV-DINE-A1B2C3D4"). Non-sequential invoice numbers violate Nepal
// IRD rules — the CBMS real-time billing system requires a monotonically
// increasing numeric sequence per fiscal year per registrant.
//
// Fallback: if the RPC fails we emit a timestamp-derived ID rather than
// blocking the checkout. A gap in the sequence (missing number) is
// permissible under IRD rules; a blocked sale is not. The fallback is logged
// so ops can retroactively investigate.

import { createAdminClient } from '@/lib/supabase/server'

export async function getNextInvoiceNumber(restaurantId: string): Promise<string> {
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .rpc('next_invoice_number', { p_restaurant_id: restaurantId })

    if (error || !data) {
        console.error('[invoiceNumber] next_invoice_number RPC failed:', error?.message, { restaurantId })
        // Fallback: base-36 timestamp, unique but non-sequential.
        const ts = Date.now().toString(36).toUpperCase()
        return `INV-ERR-${ts}`
    }

    return data as string
}
