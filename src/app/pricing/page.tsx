'use client'

import { useState } from 'react'
import { CheckCircle2, ArrowRight, HelpCircle } from 'lucide-react'
import { MarketingNav, MarketingFooter, MarketingButton, Eyebrow } from '@/components/marketing'
import Link from 'next/link'
import { useFeatures } from '@/lib/contexts/FeatureContext'

const PRICING_PLANS = [
    {
        name: 'Free',
        price: '0',
        description: 'For individuals & starters looking to digitize their kitchen.',
        features: [
            'Up to 100 Dishes & 10 Categories',
            'Dine-in & Digital QR Menu',
            'Basic KOT/BOT Management',
            'Limited Income & Expense Tracking',
            'Daybook (Daily Closing)',
        ],
        limitations: [
            'No Customer Orders or Reservations',
            'No Low Stock Alerts',
            'No Custom User Roles',
        ],
        cta: 'Start for Free',
        href: '/signup',
        popular: false,
    },
    {
        name: 'Basic',
        price: '10,000',
        description: 'Perfect for tracking order management and basic needs.',
        features: [
            'Up to 5 Users Login',
            'Up to 20 Tables & 500 Dishes',
            'Dine-in, Delivery & QR Ordering',
            'Up to 30 Customer Management',
            'Full History of Transitions',
            'Standard Support',
        ],
        cta: 'Start 14-Day Trial',
        href: '/signup',
        popular: false,
    },
    {
        name: 'Premium',
        price: '22,000',
        description: 'Perfect for growing restaurants looking to scale rapidly.',
        features: [
            'Up to 24 Users & 50 Tables',
            'Up to 1000 Dishes',
            'Takeaway, Pickup & Reservations',
            'Live Sales & Finance Insights',
            'Low Stock Alerts (Email/SMS)',
            'Custom User Roles',
            'Daybook Closing Alerts',
        ],
        cta: 'Start 14-Day Trial',
        href: '/signup',
        popular: true,
    },
    {
        name: 'Platinum',
        price: '58,000',
        description: 'For large sized teams with multi-kitchen departments.',
        features: [
            'Unlimited Users, Tables & Dishes',
            'Multi-Outlet Management',
            'eBilling Setup (IRD Compliant)',
            'Advanced Insights & Reporting',
            'Custom Domain & Branding',
            'Unlimited Activity Logs',
            '24/7 Priority Support',
        ],
        cta: 'Contact Sales',
        href: '/contact',
        popular: false,
    }
]

const FAQS = [
    { q: "Is there a free trial available?", a: "Yes, all paid plans come with a 14-day free trial so you can test all the premium features before committing." },
    { q: "Can I upgrade or downgrade later?", a: "Absolutely. You can upgrade, downgrade, or cancel your plan at any time right from your dashboard." },
    { q: "Are there any hidden setup fees?", a: "No hidden fees. Setup and standard onboarding support are fully included in your subscription." },
    { q: "Do I need special hardware?", a: "No, kkkhane works perfectly on any Android, iOS device, tablet, or desktop web browser." },
    { q: "Is it IRD Compliant?", a: "Yes, our higher-tier plans include full eBilling integration compliant with Nepal's Inland Revenue Department." },
    { q: "What happens if I cancel?", a: "You can cancel anytime. If you cancel a paid plan, your account will revert to the Free version after the billing period ends." }
]

export default function PricingPage() {
    const [billingCycle, setBillingCycle] = useState<'yearly' | 'monthly'>('yearly')
    const { currencySymbol } = useFeatures()

    return (
        <div className="min-h-screen bg-[#FAFAF8] text-gray-900 font-sans selection:bg-[var(--color-primary)] selection:text-white">
            <MarketingNav />

            {/* Hero Section */}
            <section className="pt-32 pb-16 px-4 relative overflow-hidden bg-white border-b border-gray-100">
                <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 bg-purple-50 rounded-full blur-3xl opacity-50"></div>
                <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-50"></div>

                <div className="max-w-[1000px] mx-auto text-center relative z-10">
                    <div className="mb-6 inline-flex justify-center"><Eyebrow tone="brand">Transparent Pricing</Eyebrow></div>
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-gray-900 mb-6">
                        Plans that scale with your <span className="text-[var(--color-primary)]">Restaurant</span>
                    </h1>
                    <p className="text-lg md:text-xl text-gray-500 max-w-2xl mx-auto font-medium">
                        No credit card required for the free trial. No hidden fees. Upgrade anytime, or cancel whenever you want.
                    </p>
                </div>
            </section>

            {/* Pricing Section */}
            <section className="py-16 px-4 max-w-[1200px] mx-auto relative z-20 -mt-8">
                {/* Billing Toggle */}
                <div className="flex justify-center mb-16">
                    <div className="bg-gray-100 p-1.5 rounded-full inline-flex relative border border-gray-200">
                        {/* Toggle Pill Background */}
                        <div
                            className={`absolute top-1.5 bottom-1.5 w-32 rounded-full transition-transform duration-300 ease-in-out ${billingCycle === 'yearly' ? 'bg-[var(--color-primary)] translate-x-32' : 'bg-white shadow-sm translate-x-0'}`}
                        />
                        <button
                            onClick={() => setBillingCycle('monthly')}
                            className={`relative z-10 w-32 py-2.5 rounded-full font-bold text-sm transition-colors ${billingCycle === 'monthly' ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Monthly
                        </button>
                        <button
                            onClick={() => setBillingCycle('yearly')}
                            className={`relative z-10 w-32 py-2.5 rounded-full font-bold text-sm transition-colors ${billingCycle === 'yearly' ? 'text-white' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            Yearly
                            <span className={`absolute -top-3 -right-2 z-20 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm border border-white transition-colors ${billingCycle === 'yearly' ? 'bg-green-500 text-white' : 'bg-green-100 text-green-700'}`}>Save 20%</span>
                        </button>
                    </div>
                </div>

                {/* Pricing Cards */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch pt-8 pb-8">
                    {PRICING_PLANS.map((plan) => (
                        <div
                            key={plan.name}
                            className={`relative bg-white rounded-3xl p-8 flex flex-col border transition-all duration-300 ${plan.popular ? 'border-[var(--color-primary)] shadow-2xl z-10 lg:scale-105' : 'border-gray-100 shadow-sm hover:shadow-md'}`}
                        >
                            {plan.popular && (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2">
                                    <span className="bg-[var(--color-primary)] text-white text-xs font-black uppercase tracking-wider py-1 px-4 rounded-full shadow-md">
                                        Most Popular
                                    </span>
                                </div>
                            )}

                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
                                <p className="text-sm text-gray-500 font-medium h-10">{plan.description}</p>
                            </div>

                            <div className="mb-8">
                                <div className="flex items-baseline gap-1">
                                    <span className="text-gray-500 font-bold">{currencySymbol}</span>
                                    <span className="text-4xl font-black text-gray-900 tracking-tight">
                                        {billingCycle === 'yearly' ? plan.price : Math.round(parseInt(plan.price.replace(/,/g, '')) / 10).toLocaleString()}
                                    </span>
                                </div>
                                <span className="text-sm font-medium text-gray-500">/{billingCycle === 'yearly' ? 'year' : 'month'}</span>
                            </div>

                            <MarketingButton
                                href={plan.href}
                                variant={plan.popular ? 'primary' : 'secondary'}
                                className="w-full mb-8 justify-center"
                            >
                                {plan.cta}
                            </MarketingButton>

                            <div className="space-y-4 flex-1">
                                <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-4">Includes:</p>
                                {plan.features.map(f => (
                                    <div key={f} className="flex gap-3 text-sm font-medium text-gray-700">
                                        <CheckCircle2 size={18} className="text-[var(--color-primary)] shrink-0" />
                                        <span>{f}</span>
                                    </div>
                                ))}

                                {plan.limitations && (
                                    <>
                                        <div className="pt-4 border-t border-gray-100 mt-4">
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Limitations:</p>
                                            {plan.limitations.map(l => (
                                                <div key={l} className="flex gap-3 text-sm font-medium text-gray-400">
                                                    <div className="w-[18px] flex justify-center text-gray-300 font-black shrink-0">-</div>
                                                    <span>{l}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Enterprise / Combo Banner */}
            <section className="py-12 px-4 max-w-[1000px] mx-auto">
                <div className="bg-gray-900 rounded-[2rem] p-8 md:p-12 text-white flex flex-col md:flex-row items-center justify-between gap-8 shadow-2xl relative overflow-hidden">
                    <div className="absolute -right-20 -top-20 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>

                    <div className="relative z-10 max-w-xl">
                        <div className="inline-flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full text-xs font-bold tracking-wider mb-4 border border-white/10">
                            Enterprise & Combos
                        </div>
                        <h3 className="text-3xl font-extrabold mb-3">Need Custom Hardware & Software?</h3>
                        <p className="text-gray-400 font-medium text-lg">
                            We offer special Combo Packages including Professional Thermal Printers and Power Backups perfectly synced with your KKKhane software.
                        </p>
                    </div>
                    <div className="relative z-10 shrink-0">
                        <Link href="/contact" className="inline-flex items-center justify-center bg-white text-black px-8 py-4 rounded-full font-bold text-lg hover:bg-gray-100 transition-colors">
                            Talk to Sales <ArrowRight size={20} className="ml-2" />
                        </Link>
                    </div>
                </div>
            </section>

            {/* FAQ Section */}
            <section className="py-20 bg-white border-t border-gray-100">
                <div className="max-w-[800px] mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-extrabold text-gray-900 mb-4">Frequently Asked Questions</h2>
                        <p className="text-gray-500 font-medium">Everything you need to know about our pricing.</p>
                    </div>

                    <div className="space-y-6">
                        {FAQS.map((faq, i) => (
                            <div key={i} className="flex gap-4">
                                <HelpCircle className="text-[var(--color-primary)] shrink-0 mt-1" size={24} />
                                <div>
                                    <h4 className="text-lg font-bold text-gray-900 mb-2">{faq.q}</h4>
                                    <p className="text-gray-600 font-medium leading-relaxed">{faq.a}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
