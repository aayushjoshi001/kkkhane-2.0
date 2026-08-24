// The VAT line on a room folio, in one place.
//
// lib/folio.ts computes what the guest is actually charged; the three cashier
// screens each render a preview of that same bill. The screens carried no VAT
// term at all — `grep vatEnabled` across RoomBillingModal, CashierClient and
// CashierRoomManager returned nothing — so for a tenant with VAT switched on,
// every quote was short by the tax. The cashier collected the quoted figure,
// the settlement recorded the authoritative one, and the difference was left
// as an uncollected balance on a guest who had already left.
//
// This is the third money rule to be centralised after the same failure mode
// (see lib/roomServiceCharge.ts and lib/invoiceSummary.ts). Both the server
// folio and the previews call this; neither computes it privately.

export interface FolioVatFeatures {
    vatEnabled?: boolean
    defaultTaxRate?: number
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/**
 * VAT on a stay. The base is the discounted room charge plus manual charges
 * only — room-service items are priced with their own tax at order time, so
 * taxing them again here would charge it twice.
 *
 * @param netStayCost  Room charge AFTER any discount (folio: stayCost - discountAmount).
 * @param chargesTotal Manual folio charges (laundry, parking, …).
 */
export function computeFolioVat(
    netStayCost: number,
    chargesTotal: number,
    features?: FolioVatFeatures | null
): number {
    if (!features?.vatEnabled) return 0
    const rate = Number(features?.defaultTaxRate) || 0
    if (!rate) return 0
    return round2(((Number(netStayCost) || 0) + (Number(chargesTotal) || 0)) * (rate / 100))
}
