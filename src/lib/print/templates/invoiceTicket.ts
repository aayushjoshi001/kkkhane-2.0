// Shared shape for a settled table/room invoice. The invoice is rendered and
// printed as HTML through the browser (see InvoiceReceipt.tsx, which is styled
// for an 80mm roll) rather than as raw ESC/POS — some thermal printers whose
// CUPS queue isn't a raw pass-through render ESC/POS command bytes as garbage.
// Only KOT/BOT station tickets still go out as raw ESC/POS via QZ Tray.

export interface InvoiceLineItem {
    name: string
    quantity: number
    unitPrice: number
    status?: string
}

export interface InvoiceManualCharge {
    id: string
    description: string
    amount: number
}

export interface ActiveInvoice {
    type: 'room' | 'table'
    id: string
    label: string
    roomType?: string
    guestName: string
    guestPhone?: string | null
    nights: number
    basePrice: number
    stayCost: number
    qrOrders: InvoiceLineItem[]
    qrOrdersTotal: number
    linkedOrders?: InvoiceLineItem[]
    linkedOrdersTotal?: number
    manualCharges: InvoiceManualCharge[]
    manualChargesTotal: number
    total: number
    advancePaid?: number
    advanceMethod?: string
    balanceDue?: number
    paymentMethod?: 'cash' | 'qr_digital' | 'both'
    cashPaid?: number
    qrPaid?: number
}
