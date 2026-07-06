'use client'

import { FileText, Building, Shield } from 'lucide-react'

interface InvoiceBannerProps {
    invoiceNumber: string
    panNumber?: string | null
    restaurantName?: string | null
    vatRegistered?: boolean | null
}

export default function InvoiceBanner({
    invoiceNumber,
    panNumber,
    restaurantName,
    vatRegistered,
}: InvoiceBannerProps) {
    return (
        <div className="mt-6 bg-surface rounded-[var(--border-radius)] shadow-sm border border-hairline p-5 space-y-3">
            <div className="flex items-center gap-2 text-ink">
                <FileText size={18} className="text-[var(--color-primary)]" />
                <h3 className="font-semibold">Tax Invoice</h3>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <span className="text-ink-subtle">Invoice #</span>
                    <p className="font-mono font-bold text-ink">{invoiceNumber}</p>
                </div>

                {panNumber && (
                    <div>
                        <span className="text-ink-subtle flex items-center gap-1">
                            <Building size={12} />
                            PAN
                        </span>
                        <p className="font-mono font-bold text-ink">{panNumber}</p>
                    </div>
                )}

                {restaurantName && (
                    <div className="col-span-2">
                        <span className="text-ink-subtle">Issued by</span>
                        <p className="font-medium text-ink">{restaurantName}</p>
                    </div>
                )}
            </div>

            {vatRegistered && (
                <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 w-fit">
                    <Shield size={12} />
                    VAT Registered (13%)
                </div>
            )}

            <p className="text-xs text-ink-subtle pt-1">
                This is an IRD-compliant tax invoice. Keep for your records.
            </p>
        </div>
    )
}
