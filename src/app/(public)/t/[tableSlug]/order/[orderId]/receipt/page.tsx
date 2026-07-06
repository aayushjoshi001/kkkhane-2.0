import { createAdminClient } from '@/lib/supabase/server'
import { getRestaurantFeatures } from '@/lib/features'
import { notFound } from 'next/navigation'
import PrintButton from './PrintButton'

export const revalidate = 0

export default async function ReceiptPage(props: {
    params: Promise<{ tableSlug: string; orderId: string }>
}) {
    const params = await props.params
    const adminSupabase = await createAdminClient()

    const { data: order } = await adminSupabase
        .from('orders')
        .select(`
            id, invoice_number, total_amount, subtotal_amount, discount_amount, tax_amount,
            payment_status, placed_at, restaurant_id,
            order_items (
                quantity, unit_price,
                menu_items (name),
                order_item_modifiers (modifier_name, price_adjustment)
            )
        `)
        .eq('id', params.orderId)
        .single()

    if (!order || !order.invoice_number) return notFound()

    const [{ data: restaurant }, features] = await Promise.all([
        adminSupabase
            .from('restaurants')
            .select('name, address, pan_number, vat_registered, contact_phone')
            .eq('id', order.restaurant_id)
            .single(),
        getRestaurantFeatures(order.restaurant_id),
    ])

    // Currency symbol from settings — keeps the printed receipt in the
    // restaurant's configured currency (no hardcoded Rs.).
    const sym = features?.currencySymbol?.trim()
        || (features?.currency && features.currency !== 'NPR' ? features.currency : 'Rs.')

    const subtotal = order.subtotal_amount ?? order.total_amount
    const discount = order.discount_amount ?? 0
    const tax = order.tax_amount ?? 0
    const total = order.total_amount ?? 0
    const placedAt = order.placed_at ? new Date(order.placed_at) : new Date()

    return (
        <div className="min-h-screen bg-surface-muted py-8 print:bg-surface print:py-0">
            <div className="max-w-xs mx-auto bg-surface p-6 shadow print:shadow-none font-mono text-xs text-black">
                {/* Restaurant header */}
                <div className="text-center mb-3">
                    <p className="font-bold text-sm">{restaurant?.name ?? 'Restaurant'}</p>
                    {restaurant?.address && <p className="mt-0.5">{restaurant.address}</p>}
                    {restaurant?.contact_phone && <p>{restaurant.contact_phone}</p>}
                    {restaurant?.pan_number && <p>PAN: {restaurant.pan_number}</p>}
                    {restaurant?.vat_registered && <p>VAT Registered (13%)</p>}
                </div>

                <div className="border-t border-dashed border-gray-400 my-3" />

                <p className="text-center font-bold text-sm mb-3">TAX INVOICE</p>
                <div className="flex justify-between"><span>Invoice #</span><span className="font-bold">{order.invoice_number}</span></div>
                <div className="flex justify-between"><span>Date</span><span>{placedAt.toLocaleDateString('en-NP')}</span></div>
                <div className="flex justify-between"><span>Time</span><span>{placedAt.toLocaleTimeString('en-NP', { hour: '2-digit', minute: '2-digit' })}</span></div>

                <div className="border-t border-dashed border-gray-400 my-3" />

                <div className="flex justify-between font-bold mb-1">
                    <span className="flex-1">Item</span>
                    <span className="w-6 text-center">Qty</span>
                    <span className="w-16 text-right">Price</span>
                </div>

                {order.order_items?.map((item, idx) => {
                    const name = (item.menu_items as unknown as { name: string } | null)?.name ?? 'Item'
                    const lineTotal = item.unit_price * item.quantity
                    const mods = item.order_item_modifiers as unknown as Array<{ modifier_name: string; price_adjustment: number }>
                    return (
                        <div key={idx} className="mb-1">
                            <div className="flex justify-between">
                                <span className="flex-1 pr-1">{name}</span>
                                <span className="w-6 text-center">{item.quantity}</span>
                                <span className="w-16 text-right">{sym}{lineTotal.toFixed(0)}</span>
                            </div>
                            {mods?.map((mod, mi) => (
                                <div key={mi} className="flex justify-between pl-3 text-ink-subtle">
                                    <span className="flex-1">+ {mod.modifier_name}</span>
                                    <span className="w-6 text-center">{item.quantity}</span>
                                    <span className="w-16 text-right">{sym}{(mod.price_adjustment * item.quantity).toFixed(0)}</span>
                                </div>
                            ))}
                        </div>
                    )
                })}

                <div className="border-t border-dashed border-gray-400 my-3" />

                <div className="flex justify-between"><span>Subtotal</span><span>{sym} {subtotal.toFixed(2)}</span></div>
                {discount > 0 && <div className="flex justify-between"><span>Discount</span><span>-{sym} {discount.toFixed(2)}</span></div>}
                {tax > 0 && <div className="flex justify-between"><span>VAT (13%)</span><span>{sym} {tax.toFixed(2)}</span></div>}
                <div className="border-t border-dashed border-gray-400 my-1" />
                <div className="flex justify-between font-bold text-sm">
                    <span>TOTAL</span>
                    <span>{sym} {total.toFixed(2)}</span>
                </div>
                {order.payment_status === 'paid' && (
                    <div className="flex justify-between mt-1"><span>Status</span><span className="font-bold">PAID ✓</span></div>
                )}

                <div className="border-t border-dashed border-gray-400 my-3" />
                <p className="text-center">Thank you for dining with us!</p>
                <p className="text-center text-ink-subtle text-[10px] mt-1">IRD-compliant tax invoice</p>
            </div>

            {/* Print / download button — hidden when actually printing */}
            <div className="mt-4 text-center print:hidden">
                <PrintButton />
            </div>
        </div>
    )
}
