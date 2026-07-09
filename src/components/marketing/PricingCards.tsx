import Link from 'next/link'
import { Check, Minus, ArrowRight } from 'lucide-react'
import {
    PLANS,
    CURRENCY_SYMBOL,
    formatPrice,
    renewalPrice,
    type Plan,
    type Benefit,
} from '@/lib/pricing'

/** Muted, badged row for anything not shipped yet. Never reads as available. */
function BenefitRow({ benefit, tone = 'default' }: { benefit: Benefit; tone?: 'default' | 'invert' }) {
    const invert = tone === 'invert'
    const muted = benefit.comingSoon

    return (
        <li className="flex items-start gap-3 text-sm leading-relaxed">
            <Check
                size={16}
                className={`mt-1 shrink-0 ${
                    muted
                        ? invert ? 'text-white/25' : 'text-ink-subtle/40'
                        : invert ? 'text-brand-400' : 'text-[var(--color-primary)]'
                }`}
            />
            <span className={muted ? (invert ? 'text-white/40' : 'text-ink-subtle/70') : invert ? 'text-gray-200' : 'text-ink-muted'}>
                {benefit.label}
                {muted && (
                    <span
                        className={`ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider ${
                            invert ? 'bg-white/10 text-white/50' : 'bg-surface-muted text-ink-subtle'
                        }`}
                    >
                        Coming soon
                    </span>
                )}
            </span>
        </li>
    )
}

function PriceBlock({ plan, invert }: { plan: Plan; invert: boolean }) {
    const { price } = plan

    if (price.kind === 'contact') {
        return (
            <div className="mb-8">
                <span className={`text-4xl font-black tracking-tight ${invert ? 'text-white' : 'text-ink'}`}>
                    Contact Us
                </span>
            </div>
        )
    }

    if (price.kind === 'free') {
        return (
            <div className="mb-8 flex items-end gap-2">
                <span className={`text-4xl font-black tracking-tight ${invert ? 'text-white' : 'text-ink'}`}>
                    {CURRENCY_SYMBOL} 0
                </span>
                <span className="mb-1 text-sm font-medium text-ink-subtle">/forever</span>
            </div>
        )
    }

    const discounted = price.firstYear !== price.list
    const renewal = renewalPrice(price)

    return (
        <div className="mb-8">
            {discounted && (
                <span className="mr-2 text-lg font-bold text-ink-subtle line-through decoration-2">
                    {CURRENCY_SYMBOL} {formatPrice(price.list)}
                </span>
            )}
            <div className="flex items-end gap-2">
                <span className={`text-4xl font-black tracking-tight ${invert ? 'text-white' : 'text-ink'}`}>
                    {CURRENCY_SYMBOL} {formatPrice(price.firstYear)}
                </span>
                <span className="mb-1 text-sm font-medium text-ink-subtle">/yr</span>
            </div>
            {price.renewsAtHalfList && renewal !== null && (
                <p className="mt-2 text-xs font-medium text-ink-subtle">
                    Renews at {CURRENCY_SYMBOL} {formatPrice(renewal)}/yr — 50% off list.
                </p>
            )}
        </div>
    )
}

function PlanCard({ plan }: { plan: Plan }) {
    const invert = Boolean(plan.popular)

    return (
        <div
            className={`relative flex flex-col overflow-hidden rounded-[2rem] p-8 transition-all ${
                invert
                    ? 'z-10 border border-gray-800 bg-ink shadow-2xl shadow-gray-900/20 lg:scale-[1.03]'
                    : 'border border-hairline bg-surface shadow-sm hover:border-hairline-strong hover:shadow-md'
            }`}
        >
            {invert && (
                <>
                    <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-brand-500 opacity-20 blur-[80px]" />
                    <div className="absolute right-6 top-6 rounded-full bg-brand-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                        Most Popular
                    </div>
                </>
            )}

            <div className="relative z-10 flex h-full flex-col">
                <h3 className={`mb-2 text-xl font-extrabold ${invert ? 'text-white' : 'text-ink'}`}>{plan.name}</h3>
                <p className="mb-6 min-h-[40px] text-sm font-medium leading-relaxed text-ink-subtle">{plan.tagline}</p>

                <PriceBlock plan={plan} invert={invert} />

                <Link
                    href={plan.cta.href}
                    className={`mb-8 w-full rounded-2xl py-3.5 text-center font-bold transition-colors ${
                        invert
                            ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/20 hover:bg-brand-400'
                            : 'border border-hairline-strong bg-surface-muted text-ink hover:bg-surface'
                    }`}
                >
                    {plan.cta.label}
                </Link>

                <div className="flex-1 space-y-6">
                    <div>
                        <p className={`mb-4 text-xs font-bold uppercase tracking-wider ${invert ? 'text-white/60' : 'text-ink'}`}>
                            {plan.headline.title}
                        </p>
                        <ul className="space-y-3">
                            {plan.headline.items.map(item => (
                                <BenefitRow key={item.label} benefit={item} tone={invert ? 'invert' : 'default'} />
                            ))}
                        </ul>
                    </div>

                    {plan.benefits.length > 0 && (
                        <div className="border-t border-hairline pt-6">
                            <p className={`mb-4 text-xs font-bold uppercase tracking-wider ${invert ? 'text-white/60' : 'text-ink'}`}>
                                Benefits
                            </p>
                            <ul className="space-y-3">
                                {plan.benefits.map(b => (
                                    <BenefitRow key={b.label} benefit={b} tone={invert ? 'invert' : 'default'} />
                                ))}
                            </ul>
                        </div>
                    )}

                    {plan.limitations && (
                        <div className="border-t border-hairline pt-6">
                            <p className="mb-4 text-xs font-bold uppercase tracking-wider text-ink-subtle">Limitations</p>
                            <ul className="space-y-3">
                                {plan.limitations.map(l => (
                                    <li key={l.label} className="flex items-start gap-3 text-sm leading-relaxed text-ink-subtle">
                                        <Minus size={16} className="mt-1 shrink-0 text-gray-300" />
                                        <span>{l.label}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Enterprise has no self-serve price, so it gets a band rather than a fifth column. */
function EnterpriseBand({ plan }: { plan: Plan }) {
    return (
        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-hairline bg-ink p-8 text-white shadow-2xl md:p-12">
            <div className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-[var(--color-primary)] opacity-20 blur-[100px]" />

            <div className="relative z-10 grid gap-10 lg:grid-cols-[1fr_auto]">
                <div className="max-w-2xl">
                    <h3 className="mb-3 text-3xl font-extrabold tracking-tight">{plan.name}</h3>
                    <p className="mb-8 text-lg font-medium leading-relaxed text-ink-subtle">{plan.tagline}</p>

                    <div className="grid gap-8 sm:grid-cols-2">
                        <div>
                            <p className="mb-4 text-xs font-bold uppercase tracking-wider text-white/60">{plan.headline.title}</p>
                            <ul className="space-y-3">
                                {plan.headline.items.map(item => (
                                    <BenefitRow key={item.label} benefit={item} tone="invert" />
                                ))}
                            </ul>
                        </div>
                        <div>
                            <p className="mb-4 text-xs font-bold uppercase tracking-wider text-white/60">Benefits</p>
                            <ul className="space-y-3">
                                {plan.benefits.map(b => (
                                    <BenefitRow key={b.label} benefit={b} tone="invert" />
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="flex items-start lg:items-center">
                    <Link
                        href={plan.cta.href}
                        className="inline-flex items-center justify-center rounded-2xl bg-surface px-8 py-4 text-lg font-bold text-black transition-colors hover:bg-surface-muted"
                    >
                        {plan.cta.label} <ArrowRight size={20} className="ml-2" />
                    </Link>
                </div>
            </div>
        </div>
    )
}

export default function PricingCards() {
    const selfServe = PLANS.filter(p => p.price.kind !== 'contact')
    const enterprise = PLANS.find(p => p.price.kind === 'contact')

    return (
        <div className="mx-auto max-w-[1200px]">
            <div className="grid items-start gap-6 md:grid-cols-2 lg:grid-cols-4">
                {selfServe.map(plan => (
                    <PlanCard key={plan.tier} plan={plan} />
                ))}
            </div>

            {enterprise && <EnterpriseBand plan={enterprise} />}
        </div>
    )
}
