import Link from 'next/link'
import { ArrowRight, CheckCircle, Smartphone, ChefHat, CreditCard, Users, Gift, BarChart } from 'lucide-react'
import { MarketingNav, MarketingFooter, Section, Eyebrow, MarketingButton } from '@/components/marketing'

const FEATURES = [
    { id: 1, title: 'QR Code Ordering', icon: Smartphone, description: 'Customers scan QR codes at their table to access your menu instantly on any smartphone.', items: ['No app download required', 'Real-time menu updates', 'Multiple modifier groups', 'Image support for dishes'] },
    { id: 2, title: 'Kitchen Display System', icon: ChefHat, description: 'Real-time order management with live updates and color-coded status tracking for kitchen staff.', items: ['Live order queue', 'Status management', 'Takeout order queue', 'Prep time tracking'] },
    { id: 3, title: 'Nepal QR Payments', icon: CreditCard, description: 'Accept all major Nepal payment methods with screenshot verification and full VAT compliance.', items: ['eSewa, Khalti, Fonepay', 'Screenshot verification', 'VAT & PAN compliant', 'Automatic invoice generation'] },
    { id: 4, title: 'Staff Management', icon: Users, description: 'Complete staff management with role-based access, shift tracking, and performance analytics.', items: ['4 staff role types', 'Shift clock in/out', 'Break tracking', 'Performance metrics'] },
    { id: 5, title: 'Loyalty Program', icon: Gift, description: 'Build customer loyalty with tiered rewards, points systems, and birthday bonuses.', items: ['4 membership tiers', 'Points earn/redeem', 'Birthday bonuses', 'Referral rewards'] },
    { id: 6, title: 'Analytics & Reports', icon: BarChart, description: 'Comprehensive business analytics with revenue trends, KPIs, and detailed Z-reports.', items: ['7-day trend charts', 'EOD Z-reports', 'Revenue tracking', 'COGS analysis'] },
]

export default function FeaturesPage() {
    return (
        <div className="min-h-screen bg-transparent text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-transparent pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="brand">Platform Capabilities</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-6xl">
                        Every Feature You Need
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Comprehensive restaurant management platform built specifically for Nepal&apos;s hospitality industry.
                    </p>
                </div>
            </section>

            {/* Feature grid */}
            <Section tone="band">
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {FEATURES.map((feature) => (
                        <Link key={feature.id}
                            href={`/features/${feature.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                            className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-hairline bg-surface p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--color-primary)]/30 hover:shadow-2xl">
                            <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[var(--color-primary)]/5 blur-2xl transition-colors group-hover:bg-[var(--color-primary)]/10" />
                            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-hairline bg-surface-muted text-3xl shadow-sm transition-all group-hover:scale-110 group-hover:border-[var(--color-primary)]/20 group-hover:bg-[var(--color-primary)]/10">
                                {feature.icon}
                            </div>
                            <h3 className="mb-3 text-xl font-extrabold text-ink transition-colors group-hover:text-[var(--color-primary)]">{feature.title}</h3>
                            <p className="mb-8 flex-1 font-medium leading-relaxed text-ink-subtle">{feature.description}</p>
                            <ul className="mb-8 space-y-3">
                                {feature.items.map((item) => (
                                    <li key={item} className="flex items-start gap-3 text-sm font-medium text-ink-muted">
                                        <CheckCircle size={18} className="mt-0.5 shrink-0 text-[var(--success)]" />
                                        {item}
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-auto flex items-center border-t border-hairline pt-6 text-sm font-bold text-[var(--color-primary)]">
                                Learn more <ArrowRight size={16} className="ml-2 transition-transform group-hover:translate-x-1" />
                            </div>
                        </Link>
                    ))}
                </div>
            </Section>

            {/* CTA */}
            <Section tone="dark" className="relative overflow-hidden">
                <div className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-[var(--color-primary)] opacity-20 blur-[120px]" />
                <div className="relative mx-auto max-w-2xl text-center">
                    <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">Ready to get started?</h2>
                    <p className="mx-auto mb-10 max-w-2xl text-xl font-medium text-gray-300">
                        Start your free trial today. No credit card required. Join hundreds of restaurants in Nepal.
                    </p>
                    <div className="flex flex-col justify-center gap-4 sm:flex-row">
                        <MarketingButton href="/signup" size="lg">Start Free Trial</MarketingButton>
                        <Link href="/contact" className="inline-flex items-center justify-center rounded-full bg-surface/10 px-8 py-4 text-lg font-bold text-white backdrop-blur transition-all hover:bg-surface/20">
                            Contact Sales
                        </Link>
                    </div>
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
