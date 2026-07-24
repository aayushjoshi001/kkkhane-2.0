'use client'

import Modal from '@/components/ui/Modal'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import { formatDateTime, getItemDisplayName } from '@/lib/utils'
import type { AdminOrder } from '@/app/(admin)/admin/orders/OrdersClient'
import { Clock, MapPin, Phone, User, Utensils, X } from 'lucide-react'

const STATUS_TONE: Record<string, string> = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    confirmed: 'bg-brand-50 text-brand-700 border-brand-200',
    preparing: 'bg-amber-50 text-amber-700 border-amber-200',
    ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    delivered: 'bg-success-bg/50 text-success-fg border-success-bg',
    served: 'bg-success-bg/50 text-success-fg border-success-bg',
    cancelled: 'bg-danger-bg/50 text-danger-fg border-danger-bg',
}

function Badge({ value }: { value: string }) {
    return (
        <span className={`px-2.5 py-1 rounded-full text-[10px] tracking-wide font-bold uppercase border ${STATUS_TONE[value] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
            {value}
        </span>
    )
}

/** One label/value row; renders nothing when there is no value to show. */
function Field({ label, value, icon: Icon }: { label: string; value?: string | null; icon?: React.ElementType }) {
    if (!value) return null
    return (
        <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ink-subtle">{label}</p>
            <p className="text-sm font-semibold text-ink mt-0.5 flex items-center gap-1.5 break-words">
                {Icon && <Icon size={13} className="shrink-0 text-ink-subtle" />}
                {value}
            </p>
        </div>
    )
}

/**
 * Everything recorded against one order, for a manager auditing it after the
 * fact: the line items with their prices and modifiers, the kitchen timestamps,
 * who it was for, and how the total was arrived at.
 *
 * The orders table only ever showed a count ("3 items") with the names hidden in
 * a title attribute, so a manager questioning a bill had no way to see what was
 * actually on it, what each line cost, or when the order moved through the
 * kitchen — short of querying the database.
 *
 * Rendered from the row data the list already holds, so opening it is instant
 * and needs no fetch.
 */
export default function OrderDetailModal({
    order,
    onClose,
}: {
    order: AdminOrder | null
    onClose: () => void
}) {
    const money = useCurrency()
    if (!order) return null

    const items = order.order_items || []
    const seat = order.sessions?.seat_number
    const tableLabel = order.sessions?.tables?.label
        ? `Table ${order.sessions.tables.label}${seat && seat > 1 ? ` · Seat ${seat}` : ''}`
        : null
    const roomLabel = order.bookings?.rooms?.room_number ? `Room ${order.bookings.rooms.room_number}` : null

    // Only show a money row when it carries information — a zero tip or an
    // absent discount is noise on a receipt this dense.
    const totalsRows: Array<[string, number]> = []
    if (order.subtotal_amount != null) totalsRows.push(['Subtotal', order.subtotal_amount])
    if (order.discount_amount) totalsRows.push(['Discount', -Math.abs(order.discount_amount)])
    if (order.service_charge_amount) totalsRows.push(['Service charge', order.service_charge_amount])
    if (order.tax_amount) totalsRows.push(['Tax', order.tax_amount])
    if (order.tip_amount) totalsRows.push(['Tip', order.tip_amount])

    return (
        <Modal
            open={!!order}
            onClose={onClose}
            size="lg"
            ariaLabel={`Order ${order.id.substring(0, 8).toUpperCase()} details`}
            className="overflow-hidden flex flex-col max-h-[85vh]"
        >
            <div className="px-6 py-4 border-b border-hairline flex items-center justify-between gap-3 shrink-0">
                <h3 className="font-bold text-ink font-mono tracking-wide">
                    #{order.id.substring(0, 8).toUpperCase()}
                </h3>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close order details"
                    className="inline-flex items-center justify-center min-w-9 min-h-9 -mr-1.5 rounded-xl text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors focus-ring"
                >
                    <X size={18} />
                </button>
            </div>

            {/* The item list can run long; the header stays put while it scrolls. */}
            <div className="p-6 space-y-6 overflow-y-auto">
                <div className="flex flex-wrap items-center gap-2">
                    <Badge value={order.status} />
                    <Badge value={order.payment_status} />
                    {order.order_type && <Badge value={order.order_type.replace(/_/g, ' ')} />}
                </div>

                {/* Who and where */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4 rounded-2xl bg-surface-muted/40 border border-hairline">
                    <Field label="Placed" value={formatDateTime(order.placed_at)} icon={Clock} />
                    <Field label="Location" value={roomLabel || tableLabel} icon={Utensils} />
                    <Field label="Guest" value={order.customer_name || order.bookings?.guest_name} icon={User} />
                    <Field label="Phone" value={order.customer_phone} icon={Phone} />
                    <Field label="Delivery to" value={order.delivery_address} icon={MapPin} />
                    <Field label="Paid with" value={order.payment_method?.replace(/_/g, ' ')} />
                </div>

                {/* Kitchen timeline — only the stages this order actually reached. */}
                {(order.confirmed_at || order.ready_at || order.delivered_at || order.paid_at) && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <Field label="Confirmed" value={order.confirmed_at && formatDateTime(order.confirmed_at)} />
                        <Field label="Ready" value={order.ready_at && formatDateTime(order.ready_at)} />
                        <Field label="Delivered" value={order.delivered_at && formatDateTime(order.delivered_at)} />
                        <Field label="Paid" value={order.paid_at && formatDateTime(order.paid_at)} />
                    </div>
                )}

                {/* Line items */}
                <div className="rounded-2xl border border-hairline overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-muted/50 text-[10px] uppercase tracking-wider text-ink-subtle font-bold">
                                <tr>
                                    <th className="px-4 py-3 text-left">Item</th>
                                    <th className="px-4 py-3 text-right whitespace-nowrap">Qty</th>
                                    <th className="px-4 py-3 text-right whitespace-nowrap">Unit</th>
                                    <th className="px-4 py-3 text-right whitespace-nowrap">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-hairline">
                                {items.map((item) => {
                                    const unit = item.unit_price ?? 0
                                    const modifiers = item.order_item_modifiers || []
                                    const isCancelled = item.status === 'cancelled'
                                    return (
                                        <tr key={item.id} className={isCancelled ? 'opacity-50' : undefined}>
                                            <td className="px-4 py-3">
                                                <p className={`font-semibold text-ink ${isCancelled ? 'line-through' : ''}`}>
                                                    {getItemDisplayName(item)}
                                                </p>
                                                {modifiers.length > 0 && (
                                                    <p className="text-xs text-ink-subtle mt-0.5">
                                                        {modifiers.map((m) => m.modifier_name).join(', ')}
                                                    </p>
                                                )}
                                                {/* getItemDisplayName folds a leading "[Variation]" into
                                                    the name, so only show a note that says something more. */}
                                                {item.special_request && !/^\[.*\]$/.test(item.special_request.trim()) && (
                                                    <p className="text-xs text-amber-700 mt-0.5">{item.special_request}</p>
                                                )}
                                                {item.status && (
                                                    <span className="inline-block mt-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-subtle">
                                                        {item.status}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-ink">{item.quantity}</td>
                                            <td className="px-4 py-3 text-right tabular-nums text-ink-subtle whitespace-nowrap">{money(unit)}</td>
                                            <td className="px-4 py-3 text-right tabular-nums font-bold text-ink whitespace-nowrap">{money(unit * item.quantity)}</td>
                                        </tr>
                                    )
                                })}
                                {items.length === 0 && (
                                    <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-subtle font-semibold">No items on this order.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Totals */}
                <div className="space-y-1.5 text-sm">
                    {totalsRows.map(([label, amount]) => (
                        <div key={label} className="flex justify-between">
                            <span className="text-ink-subtle font-medium">{label}</span>
                            <span className="tabular-nums font-semibold text-ink">{money(amount)}</span>
                        </div>
                    ))}
                    <div className="flex justify-between pt-2 border-t border-hairline">
                        <span className="font-bold text-ink">Total</span>
                        <span className="tabular-nums font-extrabold text-ink text-base">{money(order.total_amount ?? 0)}</span>
                    </div>
                    {!!order.refunded_amount && (
                        <div className="flex justify-between text-danger-fg">
                            <span className="font-bold">Refunded</span>
                            <span className="tabular-nums font-extrabold">−{money(order.refunded_amount)}</span>
                        </div>
                    )}
                </div>

                {order.customer_note && (
                    <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Customer note</p>
                        <p className="text-sm text-amber-900 mt-1">{order.customer_note}</p>
                    </div>
                )}

                {order.cancellation_reason && (
                    <div className="p-4 rounded-2xl bg-danger-bg/40 border border-danger-bg">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-danger-fg">Cancellation reason</p>
                        <p className="text-sm text-ink mt-1">{order.cancellation_reason}</p>
                    </div>
                )}
            </div>
        </Modal>
    )
}
