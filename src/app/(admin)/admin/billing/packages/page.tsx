'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { CheckCircle2, Star, Building2, HelpCircle, Zap } from 'lucide-react'
import { selectFreePlanAction } from './actions'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { PLANS, CURRENCY_SYMBOL, formatPrice } from '@/lib/pricing'

type BillingCycle = 'monthly' | 'yearly'

export default function PackagesPage() {
    const router = useRouter()
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
    const [cycle, setCycle] = useState<BillingCycle>('yearly')

    async function handleSelectFree() {
        setLoadingPlan('free')
        try {
            const res = await selectFreePlanAction()
            if (res.error) throw new Error(res.error)
            toast.success('Switched to Free plan')
            window.location.href = '/admin/dashboard'
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setLoadingPlan(null)
        }
    }

    function handleSelectPaid(tier: string) {
        setLoadingPlan(tier)
        router.push(`/admin/billing/checkout?plan=${tier}&cycle=${cycle}`)
    }

    const paidPlans = PLANS.filter(p => p.price.kind === 'yearly')
    const enterprise = PLANS.find(p => p.price.kind === 'contact')

    return (
        <div className="max-w-7xl mx-auto py-8 px-4">
            <div className="text-center max-w-2xl mx-auto mb-10">
                <Badge tone="brand" className="mb-4">Subscription & Billing</Badge>
                <h1 className="text-3xl font-bold text-ink mb-3 tracking-tight">Choose your plan</h1>
                <p className="text-ink-muted">
                    Your trial or previous subscription has ended. Activate a plan to keep your restaurant running.
                </p>
            </div>

            {/* Billing toggle */}
            <div className="flex justify-center mb-10">
                <div className="flex items-center rounded-full border border-hairline-strong bg-surface-muted p-1 gap-1">
                    <button
                        onClick={() => setCycle('monthly')}
                        className={`rounded-full px-5 py-2 text-sm font-bold transition-all duration-200 ${cycle === 'monthly' ? 'bg-surface shadow text-ink' : 'text-ink-subtle hover:text-ink'}`}
                    >
                        Monthly
                    </button>
                    <button
                        onClick={() => setCycle('yearly')}
                        className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-all duration-200 ${cycle === 'yearly' ? 'bg-surface shadow text-ink' : 'text-ink-subtle hover:text-ink'}`}
                    >
                        Yearly
                        <span className="rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Save 30%</span>
                    </button>
                </div>
            </div>

            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 items-start mb-6">
                {/* Free plan */}
                <Card className="p-7 flex flex-col h-full border-2 border-transparent hover:border-hairline-strong transition-colors">
                    <h3 className="text-xl font-bold text-ink mb-1">Free</h3>
                    <p className="text-sm text-ink-subtle mb-5 min-h-[40px]">
                        For small dhabas and kiosks. No IRD invoice or digital payments.
                    </p>
                    <div className="mb-5">
                        <span className="text-3xl font-extrabold text-ink">{CURRENCY_SYMBOL} 0</span>
                        <span className="text-ink-subtle text-sm"> / forever</span>
                    </div>
                    <ul className="space-y-3 mb-7 flex-1 text-sm">
                        {['50 dishes, 5 tables, 2 staff', 'QR menu & dine-in ordering', 'KOT printing', 'Cash receipt only'].map(f => (
                            <li key={f} className="flex items-start gap-2">
                                <CheckCircle2 size={15} className="text-ink-subtle shrink-0 mt-0.5" />
                                <span className="text-ink-muted">{f}</span>
                            </li>
                        ))}
                    </ul>
                    <Button block variant="secondary" loading={loadingPlan === 'free'} onClick={handleSelectFree}>
                        Continue with Free
                    </Button>
                </Card>

                {/* Paid plans */}
                {paidPlans.map(plan => {
                    const price = plan.price
                    if (price.kind !== 'yearly') return null
                    const isPopular = plan.popular
                    const displayPrice = cycle === 'monthly' && price.monthly
                        ? price.monthly
                        : price.firstYear
                    const suffix = cycle === 'monthly' ? '/mo' : '/yr'
                    const perDay = cycle === 'monthly' && price.monthly
                        ? Math.round(price.monthly / 30)
                        : Math.round(price.firstYear / 365)

                    return (
                        <Card
                            key={plan.tier}
                            className={`p-7 flex flex-col h-full transition-all ${
                                isPopular
                                    ? 'border-2 border-brand-500 shadow-xl relative'
                                    : 'border-2 border-transparent hover:border-hairline-strong'
                            }`}
                        >
                            {isPopular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                                    <span className="bg-brand-500 text-white text-[11px] font-bold uppercase tracking-wider rounded-full px-3 py-1">
                                        Most Popular
                                    </span>
                                </div>
                            )}

                            <div className="flex items-center gap-2 mb-1">
                                {plan.tier === 'premium' && <Zap size={16} className="text-brand-500" />}
                                {plan.tier === 'platinum' && <Star size={16} className="text-amber-500" />}
                                <h3 className="text-xl font-bold text-ink">{plan.name}</h3>
                            </div>
                            <p className="text-sm text-ink-subtle mb-5 min-h-[40px]">{plan.tagline}</p>

                            <div className="mb-1">
                                {cycle === 'yearly' && price.firstYear !== price.list && (
                                    <span className="text-sm font-semibold text-ink-subtle line-through mr-2">
                                        {CURRENCY_SYMBOL} {formatPrice(price.list)}
                                    </span>
                                )}
                                <span className="text-3xl font-extrabold text-ink">
                                    {CURRENCY_SYMBOL} {formatPrice(displayPrice)}
                                </span>
                                <span className="text-ink-subtle text-sm">{suffix}</span>
                            </div>
                            <p className="text-xs font-semibold text-[var(--color-primary)] mb-1">
                                Only {CURRENCY_SYMBOL} {perDay}/day
                            </p>
                            {cycle === 'yearly' && price.renewsAtHalfList && (
                                <p className="text-xs text-ink-subtle mb-4">
                                    Renews at {CURRENCY_SYMBOL} {formatPrice(price.list / 2)}/yr after year 1
                                </p>
                            )}
                            {cycle === 'monthly' && <div className="mb-4" />}

                            <ul className="space-y-2.5 mb-7 flex-1 text-sm">
                                {plan.headline.items.map(item => (
                                    <li key={item.label} className="flex items-start gap-2">
                                        <CheckCircle2 size={15} className={`shrink-0 mt-0.5 ${isPopular ? 'text-brand-500' : 'text-[var(--color-primary)]'}`} />
                                        <span className="text-ink font-medium">{item.label}</span>
                                    </li>
                                ))}
                            </ul>

                            <Button
                                block
                                variant={isPopular ? 'primary' : 'secondary'}
                                loading={loadingPlan === plan.tier}
                                onClick={() => handleSelectPaid(plan.tier)}
                                className={isPopular ? 'bg-brand-600 hover:bg-brand-700 shadow-lg shadow-brand-500/25' : ''}
                            >
                                Upgrade to {plan.name}
                            </Button>
                        </Card>
                    )
                })}

                {/* Enterprise */}
                {enterprise && (
                    <Card className="p-7 flex flex-col h-full border-2 border-transparent hover:border-hairline-strong transition-colors bg-surface-muted">
                        <div className="flex items-center gap-2 mb-1">
                            <Building2 size={16} className="text-ink-muted" />
                            <h3 className="text-xl font-bold text-ink">{enterprise.name}</h3>
                        </div>
                        <p className="text-sm text-ink-subtle mb-5 min-h-[40px]">{enterprise.tagline}</p>
                        <div className="mb-5">
                            <span className="text-3xl font-extrabold text-ink">Custom</span>
                        </div>
                        <ul className="space-y-2.5 mb-7 flex-1 text-sm">
                            {enterprise.headline.items.map(item => (
                                <li key={item.label} className="flex items-start gap-2">
                                    <CheckCircle2 size={15} className="text-ink-muted shrink-0 mt-0.5" />
                                    <span className="text-ink-muted">{item.label}</span>
                                </li>
                            ))}
                        </ul>
                        <Button block variant="secondary" onClick={() => window.location.href = 'mailto:info.kkkhane@gmail.com?subject=Enterprise%20Plan%20Inquiry'}>
                            Contact Sales
                        </Button>
                    </Card>
                )}
            </div>

            <div className="mt-10 bg-blue-50 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                        <HelpCircle size={20} className="text-blue-600" />
                    </div>
                    <div>
                        <p className="font-semibold text-ink">Not sure which plan?</p>
                        <p className="text-sm text-blue-800/80">Our team will help you pick the right fit. No pressure.</p>
                    </div>
                </div>
                <Button variant="secondary" className="whitespace-nowrap" onClick={() => window.location.href = 'mailto:info.kkkhane@gmail.com'}>
                    Talk to us
                </Button>
            </div>
        </div>
    )
}
