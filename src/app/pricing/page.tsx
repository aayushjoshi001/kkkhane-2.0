import { HelpCircle } from 'lucide-react'
import { MarketingNav, MarketingFooter, Eyebrow, PricingCards } from '@/components/marketing'

const FAQS = [
    { q: "Is the Free plan really free forever?", a: "Yes — no credit card, no expiry. The Free plan is built for small dhabas and food kiosks: up to 50 dishes, 5 tables, and 2 staff. The main limit is that IRD-compliant VAT invoicing and Nepal Pay (eSewa/Khalti/Fonepay) require Basic or above." },
    { q: "Which plan do I need for a proper restaurant?", a: "Basic (Rs. 9,999/yr) is the right starting point for any registered restaurant. It adds IRD VAT/PAN invoices, Nepal Pay, Day Book (Rojnamcha), Cash Book, and Bank Book — everything the IRD expects and every accountant will ask for." },
    { q: "Can I pay monthly instead of yearly?", a: "Yes. Basic is Rs. 1,099/mo, Premium Rs. 2,699/mo, and Platinum Rs. 5,499/mo. Annual billing saves roughly 30%. Premium and Platinum also renew at 50% of list after the first year — so the longer you stay, the less you pay." },
    { q: "What does the renewal discount mean?", a: "Premium lists at Rs. 34,999 and renews at Rs. 17,499/yr after year one. Platinum lists at Rs. 59,999 and renews at Rs. 29,999/yr. The first-year price is an entry offer; the renewal is a loyalty reward." },
    { q: "How is KKKhane different from Hamrobill or Petpooja?", a: "Hamrobill covers billing and basic accounts — it has no QR ordering, no live Kitchen Display, and no cloud access. Petpooja is India-first and costs more for equivalent features in Nepal. KKKhane is built specifically for Nepal: Bikram Sambat dates, eSewa/Khalti/Fonepay built in, and IRD compliance from Day 1." },
    { q: "Does it work for hotels?", a: "Yes — Platinum includes full hotel management: room bookings, guest check-in/out, folio billing, and integrated restaurant charges all on one bill. No separate PMS software needed." },
    { q: "Is it IRD compliant?", a: "Yes. Invoices carry sequential, tamper-evident numbering with VAT/PAN fields, built to Nepal IRD rules. Bikram Sambat date support and IRD eBilling sync (coming soon) are on Platinum and above." },
    { q: "Can I upgrade or downgrade at any time?", a: "Yes. Upgrading is instant. Downgrading takes effect at the next billing cycle; your data stays — you just can't add beyond the new plan's limits." },
    { q: "Do I need special hardware or a fast internet?", a: "No special hardware. KKKhane runs on any phone, tablet, or desktop browser. Thermal printers are supported for KOT and invoices. Offline ordering support is on our roadmap." },
    { q: "Are there hidden fees or setup charges?", a: "None. Setup, data migration help, and standard onboarding are included in every paid plan. Payment gateway fees (eSewa, Khalti, Fonepay) are charged by the gateway directly to you — we don't take a cut." },
]

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-transparent text-ink font-sans selection:bg-[var(--color-primary)] selection:text-white">
            <MarketingNav />

            {/* Hero Section */}
            <section className="pt-32 pb-16 px-4 relative overflow-hidden bg-transparent border-b border-hairline">
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
            <section className="py-20 bg-transparent border-t border-hairline">
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
