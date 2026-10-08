'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { ArrowRight, ArrowLeft, Building2, Zap } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { submitPaymentReferenceAction } from './actions'
import { PLANS, CURRENCY_SYMBOL, formatPrice } from '@/lib/pricing'
import type { Tier } from '@/lib/tiers'

const VALID_PLANS: Tier[] = ['basic', 'premium', 'platinum', 'enterprise']
const BILLING_MONTHS: Record<'monthly' | 'yearly', number> = { monthly: 1, yearly: 12 }

export default function CheckoutPage() {
    const router       = useRouter()
    const searchParams = useSearchParams()

    const planParam = searchParams.get('plan') as Tier | null
    const cycleParam = searchParams.get('cycle') as 'monthly' | 'yearly' | null
    const cycle: 'monthly' | 'yearly' = cycleParam === 'monthly' ? 'monthly' : 'yearly'

    const plan = PLANS.find(p => p.tier === planParam && VALID_PLANS.includes(p.tier))

    // manual bank-transfer state (bank transfer only — all 3 digital wallets are instant now)
    const [reference,    setReference]    = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    // gateway button loading states
    const [esewaLoading,   setEsewaLoading]   = useState(false)
    const [khaltiLoading,  setKhaltiLoading]  = useState(false)
    const [fonepayLoading, setFonepayLoading] = useState(false)

    if (!plan || plan.price.kind !== 'yearly') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
                <p className="text-ink-subtle">Invalid plan selected.</p>
                <Button variant="secondary" onClick={() => router.push('/admin/billing/packages')}>
                    Back to Plans
                </Button>
            </div>
        )
    }

    const price         = plan.price
    const amount        = cycle === 'monthly' && price.monthly ? price.monthly : price.firstYear
    const billingMonths = BILLING_MONTHS[cycle]
    const perDay        = Math.round(amount / (cycle === 'monthly' ? 30 : 365))

    // --- eSewa: server creates pending record + returns form params → submit form ---
    async function handleEsewa() {
        setEsewaLoading(true)
        try {
            const res = await fetch('/api/payments/esewa/initiate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ planTier: plan!.tier, cycle }),
            })
            const data = await res.json() as { formUrl?: string; formParams?: Record<string, string | number>; error?: string }
            if (data.error || !data.formUrl || !data.formParams) {
                throw new Error(data.error ?? 'eSewa initiation failed')
            }

            // Build and submit a hidden POST form to eSewa's hosted checkout.
            const form = document.createElement('form')
            form.method = 'POST'
            form.action = data.formUrl
            Object.entries(data.formParams).forEach(([key, value]) => {
                const input   = document.createElement('input')
                input.type    = 'hidden'
                input.name    = key
                input.value   = String(value)
                form.appendChild(input)
            })
            document.body.appendChild(form)
            form.submit()
            // Loading indicator stays on — user is leaving this page.
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not start eSewa payment')
            setEsewaLoading(false)
        }
    }

    // --- FonePay: server builds signed URL → redirect ---
    async function handleFonepay() {
        setFonepayLoading(true)
        try {
            const res = await fetch('/api/payments/fonepay/initiate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ planTier: plan!.tier, cycle }),
            })
            const data = await res.json() as { paymentUrl?: string; error?: string }
            if (data.error || !data.paymentUrl) {
                throw new Error(data.error ?? 'FonePay initiation failed')
            }
            window.location.href = data.paymentUrl
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not start FonePay payment')
            setFonepayLoading(false)
        }
    }

    // --- Khalti: server creates pending record + calls Khalti API → redirect ---
    async function handleKhalti() {
        setKhaltiLoading(true)
        try {
            const res = await fetch('/api/payments/khalti/initiate', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ planTier: plan!.tier, cycle }),
            })
            const data = await res.json() as { paymentUrl?: string; error?: string }
            if (data.error || !data.paymentUrl) {
                throw new Error(data.error ?? 'Khalti initiation failed')
            }
            window.location.href = data.paymentUrl
            // Loading indicator stays on — user is leaving this page.
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not start Khalti payment')
            setKhaltiLoading(false)
        }
    }

    // --- Manual flow: bank transfer or FonePay (reference code required) ---
    async function handleManualSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!reference.trim()) {
            toast.error('Please enter the transaction reference code')
            return
        }
        setIsSubmitting(true)
        try {
            const res = await submitPaymentReferenceAction({
                amount,
                method:         'bank',
                reference_code: reference.trim(),
                notes:          `${plan!.name} plan — ${cycle === 'monthly' ? '1 month' : '1 year'}`,
                plan_tier:      plan!.tier,
                billing_months: billingMonths,
            })
            if (res.error) throw new Error(res.error)
            toast.success('Payment submitted! Our team will verify and activate within a few hours.')
            router.push('/admin/billing/pending')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <button
                onClick={() => router.back()}
                className="flex items-center gap-2 text-sm text-ink-subtle hover:text-ink mb-8 transition-colors"
            >
                <ArrowLeft size={16} /> Back to Plans
            </button>

            <div className="grid md:grid-cols-[1fr_360px] gap-8">
                <div>
                    <h1 className="text-2xl font-bold text-ink mb-1">Complete your upgrade</h1>
                    <p className="text-ink-muted mb-8 text-sm">
                        Pay with eSewa or Khalti for instant activation, or use FonePay / bank transfer for manual verification.
                    </p>

                    {/* ─── Instant gateway buttons ─── */}
                    <div className="mb-8">
                        <div className="flex items-center gap-2 mb-3">
                            <Zap size={14} className="text-[var(--color-primary)]" />
                            <h3 className="text-sm font-bold text-ink uppercase tracking-wider">Instant Activation</h3>
                            <span className="text-[10px] font-bold bg-green-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Recommended</span>
                        </div>
                        <p className="text-xs text-ink-subtle mb-4">
                            Pay with eSewa or Khalti and your plan activates automatically — no waiting for manual review.
                        </p>
                        <div className="grid grid-cols-3 gap-3">
                            {/* eSewa — green */}
                            <button
                                type="button"
                                onClick={handleEsewa}
                                disabled={esewaLoading || khaltiLoading || fonepayLoading}
                                className="relative flex flex-col items-center justify-center gap-1.5 p-4 rounded-2xl border-2 border-[#60BB46] bg-[#60BB46]/5 hover:bg-[#60BB46]/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {esewaLoading && (
                                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70">
                                        <div className="w-5 h-5 border-2 border-[#60BB46] border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                                <span className="text-lg font-black text-[#60BB46]">eSewa</span>
                                <span className="text-[11px] font-semibold text-[#60BB46]/80">
                                    {CURRENCY_SYMBOL} {formatPrice(amount)}
                                </span>
                            </button>

                            {/* Khalti — purple */}
                            <button
                                type="button"
                                onClick={handleKhalti}
                                disabled={esewaLoading || khaltiLoading || fonepayLoading}
                                className="relative flex flex-col items-center justify-center gap-1.5 p-4 rounded-2xl border-2 border-[#5C2D91] bg-[#5C2D91]/5 hover:bg-[#5C2D91]/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {khaltiLoading && (
                                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70">
                                        <div className="w-5 h-5 border-2 border-[#5C2D91] border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                                <span className="text-lg font-black text-[#5C2D91]">Khalti</span>
                                <span className="text-[11px] font-semibold text-[#5C2D91]/80">
                                    {CURRENCY_SYMBOL} {formatPrice(amount)}
                                </span>
                            </button>

                            {/* FonePay — blue */}
                            <button
                                type="button"
                                onClick={handleFonepay}
                                disabled={esewaLoading || khaltiLoading || fonepayLoading}
                                className="relative flex flex-col items-center justify-center gap-1.5 p-4 rounded-2xl border-2 border-[#1565C0] bg-[#1565C0]/5 hover:bg-[#1565C0]/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                {fonepayLoading && (
                                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-white/70">
                                        <div className="w-5 h-5 border-2 border-[#1565C0] border-t-transparent rounded-full animate-spin" />
                                    </div>
                                )}
                                <span className="text-lg font-black text-[#1565C0]">FonePay</span>
                                <span className="text-[11px] font-semibold text-[#1565C0]/80">
                                    {CURRENCY_SYMBOL} {formatPrice(amount)}
                                </span>
                            </button>
                        </div>
                    </div>

                    {/* ─── Divider ─── */}
                    <div className="relative flex items-center gap-4 mb-8">
                        <div className="flex-1 h-px bg-hairline-strong" />
                        <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wider shrink-0">
                            or bank transfer
                        </span>
                        <div className="flex-1 h-px bg-hairline-strong" />
                    </div>

                    {/* ─── Manual: Bank Transfer only ─── */}
                    <form onSubmit={handleManualSubmit} className="space-y-7">
                        <div className="flex items-center gap-3 p-4 border-2 rounded-xl border-hairline-strong bg-surface-muted">
                            <Building2 size={18} className="text-ink-subtle shrink-0" />
                            <span className="font-semibold text-sm text-ink">Bank Transfer</span>
                        </div>

                        <Card className="p-5 bg-surface-muted border-hairline-strong text-sm">
                            <div className="space-y-2">
                                <p className="font-semibold text-ink mb-3">Transfer Details</p>
                                {[
                                    ['Bank',         'NABIL BANK'],
                                    ['Account Name', 'KK KHANE PVT LTD'],
                                    ['Account No.',  '01234567890123'],
                                    ['Amount',       `${CURRENCY_SYMBOL} ${formatPrice(amount)}`],
                                ].map(([label, val]) => (
                                    <div key={label} className="flex justify-between p-2 bg-surface rounded border border-hairline">
                                        <span className="text-ink-muted">{label}</span>
                                        <span className="font-semibold text-ink font-mono">{val}</span>
                                    </div>
                                ))}
                            </div>
                        </Card>

                        <div>
                            <label className="block text-sm font-bold text-ink mb-2">
                                Transaction Reference / Voucher Code
                            </label>
                            <input
                                type="text"
                                required
                                value={reference}
                                onChange={e => setReference(e.target.value)}
                                placeholder="e.g. 0XF9A3B2C1..."
                                className="w-full px-4 py-3 rounded-xl border border-hairline-strong focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20 outline-none transition-all font-mono text-sm"
                            />
                            <p className="text-xs text-ink-subtle mt-1.5">
                                Copy the voucher code from your receipt. Our team verifies manually — usually within a few hours.
                            </p>
                        </div>

                        <Button type="submit" variant="primary" size="lg" block loading={isSubmitting} icon={ArrowRight}>
                            Submit Payment Reference
                        </Button>
                    </form>
                </div>

                {/* Order summary */}
                <div>
                    <div className="sticky top-24">
                        <Card className="p-6 border-hairline-strong">
                            <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle mb-4">Order Summary</p>

                            <div className="mb-5">
                                <p className="text-lg font-bold text-ink">{plan.name} Plan</p>
                                <p className="text-sm text-ink-subtle">{cycle === 'monthly' ? '1 month' : '1 year'} subscription</p>
                            </div>

                            <div className="space-y-2 text-sm mb-5">
                                {cycle === 'yearly' && price.firstYear !== price.list && (
                                    <div className="flex justify-between">
                                        <span className="text-ink-subtle">List price</span>
                                        <span className="line-through text-ink-subtle">{CURRENCY_SYMBOL} {formatPrice(price.list)}</span>
                                    </div>
                                )}
                                <div className="flex justify-between font-semibold text-ink border-t border-hairline pt-2 mt-2">
                                    <span>Total due</span>
                                    <span>{CURRENCY_SYMBOL} {formatPrice(amount)}</span>
                                </div>
                                <p className="text-xs text-[var(--color-primary)] font-semibold">
                                    Only {CURRENCY_SYMBOL} {perDay}/day
                                </p>
                            </div>

                            {cycle === 'yearly' && price.renewsAtHalfList && (
                                <p className="text-xs text-ink-subtle bg-surface-muted rounded-lg p-3">
                                    Renews at {CURRENCY_SYMBOL} {formatPrice(price.list / 2)}/yr after year 1 — 50% loyalty discount.
                                </p>
                            )}

                            <div className="mt-5 pt-4 border-t border-hairline space-y-2 text-xs text-ink-subtle">
                                <div className="flex items-start gap-2">
                                    <Zap size={13} className="shrink-0 mt-0.5 text-green-500" />
                                    <span>eSewa · Khalti · FonePay activate instantly</span>
                                </div>
                                <div className="flex items-start gap-2">
                                    <Building2 size={13} className="shrink-0 mt-0.5" />
                                    <span>Bank transfer verified within hours</span>
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}
