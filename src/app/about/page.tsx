import {
    MarketingNav, MarketingFooter, Section, SectionHeading, Eyebrow, FeatureCard, MarketingButton,
} from '@/components/marketing'

const DIFFERENTIATORS = [
    {
        title: '100% Nepal-Focused',
        desc: "Every feature is built with Nepal in mind. eSewa, Khalti, Fonepay. NPR currency. VAT & PAN compliance. Bikram Sambat calendar support. This isn't a global product translated to Nepali — it's architected for Nepal.",
    },
    {
        title: 'Built by Operators',
        desc: 'Our team has real restaurant experience. We understand the chaos of a Friday night rush, the importance of accurate inventory, and what actually matters to customers.',
    },
    {
        title: 'Modern UX, Offline-First',
        desc: 'Beautiful, responsive interfaces that work on any device. Built as a PWA so it works even with slow or spotty internet — critical for Nepal.',
    },
    {
        title: 'Complete Ecosystem',
        desc: 'From customer ordering to kitchen management, payments, staff coordination, and analytics — one integrated platform. No juggling 5 different tools.',
    },
]

export default function AboutPage() {
    return (
        <div className="min-h-screen bg-surface text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-surface pb-16 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="purple">Our Story</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-7xl">
                        About <span className="text-[var(--color-primary)]">kkkhane</span>
                    </h1>
                    <p className="mx-auto mt-8 max-w-2xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Built by restaurateurs, for restaurateurs. We&apos;re reimagining how restaurants in Nepal operate —
                        from customer ordering to kitchen management, staff coordination, and business analytics.
                    </p>
                </div>
            </section>

            {/* Mission */}
            <Section tone="band">
                <div className="mx-auto max-w-3xl space-y-16">
                    <div>
                        <h2 className="mb-6 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Our Mission</h2>
                        <p className="text-xl font-medium leading-relaxed text-ink-muted">
                            To empower Nepal&apos;s restaurants with technology that&apos;s as delightful for customers as it is
                            efficient for staff. Every restaurant — whether a single-table eatery or a multi-location chain —
                            deserves world-class tools to delight guests and operate profitably.
                        </p>
                    </div>
                    <div>
                        <h2 className="mb-6 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">Why We Built kkkhane</h2>
                        <div className="space-y-6 text-xl font-medium leading-relaxed text-ink-muted">
                            <p>
                                We spent years working in Nepal&apos;s hospitality industry and saw the same problems repeated:
                                paper tickets piling up in the kitchen, walkie-talkies creating confusion, payment verification
                                taking forever, and no way to track business metrics in real-time.
                            </p>
                            <p>
                                Existing solutions were either built for Western restaurants or ignored Nepal&apos;s unique payment
                                methods, tax requirements, and operational workflows. So we built kkkhane from scratch — designed
                                specifically for how Nepal does business.
                            </p>
                        </div>
                    </div>
                </div>
            </Section>

            {/* Differentiators */}
            <Section tone="white">
                <SectionHeading eyebrow="Why kkkhane" title="What Makes kkkhane Different" />
                <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
                    {DIFFERENTIATORS.map((item) => (
                        <FeatureCard key={item.title} align="left" title={item.title} desc={item.desc} />
                    ))}
                </div>
            </Section>

            {/* Backed by */}
            <Section tone="band" size="md">
                <div className="mx-auto max-w-3xl text-center">
                    <h2 className="mb-6 text-3xl font-extrabold tracking-tight text-ink">Backed by Experts</h2>
                    <p className="text-lg font-medium leading-relaxed text-ink-muted">
                        kkkhane is backed by hospitality industry veterans, software engineers from top companies, and
                        Y Combinator&apos;s expertise in building scalable businesses.
                    </p>
                </div>
            </Section>

            {/* CTA */}
            <Section tone="dark">
                <div className="mx-auto max-w-2xl text-center">
                    <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                        Join the kkkhane <span className="text-[var(--color-primary)]">revolution</span>
                    </h2>
                    <p className="mb-10 text-xl font-medium text-gray-300">
                        Help us transform how Nepal&apos;s restaurants operate. Start your free trial today and experience the difference.
                    </p>
                    <MarketingButton href="/signup" size="lg" arrow>Start Free Trial</MarketingButton>
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
