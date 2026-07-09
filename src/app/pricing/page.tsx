import { HelpCircle } from 'lucide-react'
import { MarketingNav, MarketingFooter, Eyebrow, PricingCards } from '@/components/marketing'

const FAQS = [
    { q: "Is there a free plan?", a: "Yes. The Free plan is free forever — up to 100 dishes, 10 categories and 3 staff logins, with the daybook and basic income & expense tracking. No credit card required." },
    { q: "Can I upgrade or downgrade later?", a: "Yes. You can change plan at any time. If you downgrade, you keep the data you already have; you simply cannot add beyond the new plan's limits." },
    { q: "What does the renewal discount mean?", a: "Premium and Platinum renew at 50% of their list price. Premium lists at Rs. 30,000 and renews at Rs. 15,000/yr; Platinum lists at Rs. 55,000 and renews at Rs. 27,500/yr." },
    { q: "Are there any hidden setup fees?", a: "No hidden fees. Setup and standard onboarding support are included in your subscription." },
    { q: "Do I need special hardware?", a: "No, kkkhane works on any device with a modern web browser." },
    { q: "Is it IRD compliant?", a: "Yes. Invoices carry sequential, tamper-evident numbering with VAT/PAN fields, built to Nepal's Inland Revenue Department billing rules." },
]

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-[#f6eee2] text-ink font-sans selection:bg-[var(--color-primary)] selection:text-white">
            <MarketingNav />

            {/* Hero Section */}
            <section className="pt-32 pb-16 px-4 relative overflow-hidden bg-surface border-b border-hairline">
                <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 bg-purple-50 rounded-full blur-3xl opacity-50"></div>
                <div className="absolute bottom-0 left-0 -ml-32 -mb-32 w-96 h-96 bg-blue-50 rounded-full blur-3xl opacity-50"></div>

                <div className="max-w-[1000px] mx-auto text-center relative z-10">
                    <div className="mb-6 inline-flex justify-center"><Eyebrow tone="brand">Transparent Pricing</Eyebrow></div>
                    <div className="text-center mt-12 max-w-3xl mx-auto">
                        <h2 className="text-5xl md:text-6xl font-extrabold tracking-tight text-ink mb-6">
                            Simple, transparent pricing
                        </h2>
                        <p className="text-xl text-ink-subtle font-medium leading-relaxed max-w-2xl mx-auto">
                            No hidden fees, no hardware lock-in. Choose the plan that fits your growth.
                        </p>
                    </div>
                </div>
            </section>

            {/* Pricing Section */}
            <section className="py-16 px-4 max-w-[1400px] mx-auto relative z-20 -mt-8">
                <PricingCards />
            </section>


            {/* FAQ Section */}
            <section className="py-20 bg-surface border-t border-hairline">
                <div className="max-w-[800px] mx-auto px-4">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl font-extrabold text-ink mb-4">Frequently Asked Questions</h2>
                        <p className="text-ink-subtle font-medium">Everything you need to know about our pricing.</p>
                    </div>

                    <div className="space-y-6">
                        {FAQS.map((faq, i) => (
                            <div key={i} className="flex gap-4">
                                <HelpCircle className="text-[var(--color-primary)] shrink-0 mt-1" size={24} />
                                <div>
                                    <h4 className="text-lg font-bold text-ink mb-2">{faq.q}</h4>
                                    <p className="text-ink-muted font-medium leading-relaxed">{faq.a}</p>
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
