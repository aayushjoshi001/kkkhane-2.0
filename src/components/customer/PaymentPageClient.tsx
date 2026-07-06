'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle, CreditCard, ShoppingBag, Loader2 } from 'lucide-react'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import PromoCodeInput from './PromoCodeInput'
import LoyaltyPanel from './LoyaltyPanel'
import OrderPaymentSection from './OrderPaymentSection'
import CashPaymentChoice from './CashPaymentChoice'
import OrderSplitBillSection from './OrderSplitBillSection'
import SplitBillModal from './SplitBillModal'
import { updateOrderPaymentDetails } from '@/app/(public)/t/[tableSlug]/order/[orderId]/payment/actions'
import { toast } from 'react-hot-toast'
import type { LoyaltyMember, PromoCode } from '@/types/database'

interface PaymentPageClientProps {
    order: any
    restaurantInfo: any
    features: any
    tableSlug: string
}

export default function PaymentPageClient({
    order: initialOrder,
    restaurantInfo,
    features,
    tableSlug,
}: PaymentPageClientProps) {
    const router = useRouter()
    const money = useCurrency()
    const [order, setOrder] = useState(initialOrder)
    const [isUpdating, setIsUpdating] = useState(false)
    const [appliedPromo, setAppliedPromo] = useState<PromoCode | null>(null)
    const [activeLoyaltyMember, setActiveLoyaltyMember] = useState<LoyaltyMember | null>(null)
    const [loyaltyDiscountAmount, setLoyaltyDiscountAmount] = useState(0)
    const [showSplit, setShowSplit] = useState(false)

    const restaurantId = order.restaurant_id
    const orderId = order.id

    const subtotal = Number(order.subtotal_amount || 0)
    const discount = Number(order.discount_amount || 0)
    const tax = Number(order.tax_amount || 0)
    const total = Number(order.total_amount || 0)

    const handleApplyPromo = async (promo: PromoCode | null, promoDiscountVal: number) => {
        setIsUpdating(true)
        setAppliedPromo(promo)

        const res = await updateOrderPaymentDetails(orderId, {
            promoCodeId: promo?.id || null,
            promoDiscount: promoDiscountVal,
            loyaltyDiscount: loyaltyDiscountAmount, // preserve loyalty discount
        })

        if (res.success) {
            toast.success(promo ? 'Promo code applied!' : 'Promo code removed!')
            // Refresh route data to pull fresh database totals
            router.refresh()
            const newDiscount = promoDiscountVal + loyaltyDiscountAmount
            setOrder((prev: any) => ({
                ...prev,
                discount_amount: newDiscount,
                total_amount: Math.max(0, subtotal - newDiscount + tax),
                promo_code_id: promo?.id || null,
            }))
        } else {
            toast.error(res.error || 'Failed to update order.')
        }
        setIsUpdating(false)
    }

    const handleMemberSet = (member: LoyaltyMember | null) => {
        setActiveLoyaltyMember(member)
        if (!member) {
            handleRedeemDiscount(0)
        }
    }

    const handleRedeemDiscount = async (discountVal: number) => {
        setIsUpdating(true)
        setLoyaltyDiscountAmount(discountVal)

        const res = await updateOrderPaymentDetails(orderId, {
            loyaltyMemberId: activeLoyaltyMember?.id || null,
            loyaltyDiscount: discountVal,
            promoDiscount: appliedPromo ? (order.discount_amount - loyaltyDiscountAmount) : 0, // preserve promo discount
        })

        if (res.success) {
            if (discountVal > 0) {
                toast.success('Loyalty discount applied!')
            }
            router.refresh()
            const currentPromoDiscount = appliedPromo ? (order.discount_amount - loyaltyDiscountAmount) : 0
            const newDiscount = discountVal + currentPromoDiscount
            setOrder((prev: any) => ({
                ...prev,
                discount_amount: newDiscount,
                total_amount: Math.max(0, subtotal - newDiscount + tax),
                loyalty_member_id: activeLoyaltyMember?.id || null,
            }))
        } else {
            toast.error(res.error || 'Failed to update loyalty discount.')
        }
        setIsUpdating(false)
    }

    return (
        <div className="min-h-screen bg-surface pb-36 text-ink">
            {/* Header */}
            <header className="bg-surface px-4 py-4 border-b border-hairline sticky top-0 z-20 flex items-center gap-3">
                <button
                    onClick={() => router.push(`/t/${tableSlug}/order/${orderId}`)}
                    className="p-2 -ml-2 text-ink-subtle rounded-full active:bg-surface-muted"
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-xl font-black text-ink">Payment options</h1>
            </header>

            <main className="max-w-xl mx-auto px-4 mt-6">
                {/* Order Summary Card */}
                <div className="bg-surface rounded-2xl shadow-sm border border-hairline overflow-hidden mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <div className="p-4 border-b border-hairline bg-surface-muted/30">
                        <h2 className="font-black text-sm text-ink uppercase tracking-wider">Order Summary</h2>
                    </div>

                    <ul className="divide-y divide-[#F5EDE6]">
                        {order.order_items?.map((item: any) => {
                            const modTotal = (item.order_item_modifiers || []).reduce((s: number, m: any) => s + Number(m.price_adjustment || 0), 0)
                            return (
                                <li key={item.id} className="p-4 flex gap-4 bg-surface justify-between">
                                    <div className="flex-1">
                                        <h3 className="font-bold text-sm text-ink">
                                            {item.quantity}× {item.menu_items?.name || 'Item'}
                                        </h3>
                                        {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                                            <p className="text-xs text-ink-subtle font-semibold mt-0.5">
                                                {item.order_item_modifiers.map((m: any) => m.modifier_name).join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    <span className="font-black text-brand-500 text-sm shrink-0">
                                        {money((item.unit_price + modTotal) * item.quantity)}
                                    </span>
                                </li>
                            )
                        })}
                    </ul>
                </div>

                {/* Promo Code Input */}
                {restaurantId && features?.promosEnabled !== false && (
                    <div className="bg-surface rounded-2xl shadow-sm border border-hairline p-4 mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                        <PromoCodeInput
                            restaurantId={restaurantId}
                            subtotal={subtotal}
                            onApply={handleApplyPromo}
                            onRemove={() => handleApplyPromo(null, 0)}
                            appliedPromo={appliedPromo}
                        />
                    </div>
                )}

                {/* Loyalty Panel */}
                {restaurantId && features?.loyaltyEnabled && (
                    <div className="bg-surface rounded-2xl shadow-sm border border-hairline p-4 mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                        <LoyaltyPanel
                            restaurantId={restaurantId}
                            onMemberSet={handleMemberSet}
                            onRedeemDiscount={handleRedeemDiscount}
                            activeMember={activeLoyaltyMember}
                        />
                    </div>
                )}

                {/* Bill Breakdown Card */}
                <div className="bg-surface rounded-2xl shadow-sm border border-hairline p-4 mb-6" style={{ boxShadow: "0 2px 12px rgba(232,93,4,0.04)" }}>
                    <h3 className="font-black text-xs uppercase tracking-wider text-ink-subtle mb-3">Bill Breakdown</h3>
                    <div className="space-y-2">
                        <div className="flex justify-between text-xs text-ink-subtle font-semibold">
                            <span>Subtotal</span>
                            <span>{money(subtotal)}</span>
                        </div>
                        {discount > 0 && (
                            <div className="flex justify-between text-xs text-green-600 font-bold">
                                <span>Discount</span>
                                <span>-{money(discount)}</span>
                            </div>
                        )}
                        <div className="flex justify-between items-center pt-2.5 border-t border-hairline">
                            <span className="text-ink font-black text-sm uppercase tracking-wider">Total to pay</span>
                            <span className="text-xl font-black text-brand-500 tabular-nums">
                                {isUpdating ? (
                                    <Loader2 size={18} className="animate-spin inline text-brand-500" />
                                ) : (
                                    money(total)
                                )}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Payment QR / Claims Section */}
                {order.payment_status !== 'paid' && (
                    <div className="space-y-4">
                        <OrderPaymentSection
                            orderId={orderId}
                            restaurantId={restaurantId}
                            totalAmount={total}
                            paymentStatus={order.payment_status}
                            paymentQrUrl={restaurantInfo?.payment_qr_url || null}
                            paymentQrLabel={restaurantInfo?.payment_qr_label || null}
                        />

                        {/* Cash: pay at counter, or send a waiter to collect (dine-in only) */}
                        {order.session_id && (
                            <CashPaymentChoice
                                sessionId={order.session_id}
                                restaurantId={restaurantId}
                                totalAmount={total}
                            />
                        )}

                        {order.session_id && features?.splitBillingEnabled && (
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowSplit(true)}
                                    className="w-full border-2 border-brand-500 text-brand-500 hover:bg-surface-muted font-black rounded-2xl py-3.5 text-sm active:scale-95 transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    Split Bill Options
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {order.payment_status === 'paid' && (
                    <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center mt-6 shadow-sm">
                        <p className="text-green-700 font-black text-sm flex items-center justify-center gap-1.5">
                            <CheckCircle size={16} /> Payment Completed!
                        </p>
                        <p className="text-green-600/80 text-xs mt-1 font-semibold">Thank you for dining with us!</p>
                    </div>
                )}
            </main>

            {showSplit && order.session_id && (
                <SplitBillModal
                    sessionId={order.session_id}
                    totalAmount={total}
                    onClose={() => setShowSplit(false)}
                />
            )}
        </div>
    )
}
