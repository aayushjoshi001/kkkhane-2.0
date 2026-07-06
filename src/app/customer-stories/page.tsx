import { ArrowRight, Quote } from 'lucide-react'
import { MarketingNav, MarketingFooter, Section, SectionHeading, Eyebrow, MarketingButton } from '@/components/marketing'

const STORIES = [
    {
        name: 'Himalayan Grill',
        location: 'Thamel, Kathmandu',
        emoji: '🏔️',
        gradient: 'from-indigo-50 to-blue-50',
        challenge: 'Paper tickets caused constant kitchen mix-ups during peak hours.',
        result: 'Moved the whole kitchen onto the KDS and cut order errors to near zero.',
        metric: '−42%',
        metricLabel: 'order errors',
        quote: 'The kitchen display ended the chaos of our Friday rush. Tickets never get lost anymore.',
        person: 'Bibek Lama, Owner',
    },
    {
        name: 'Cafe Mocha',
        location: 'Patan, Lalitpur',
        emoji: '☕',
        gradient: 'from-rose-50 to-orange-50',
        challenge: 'Long queues at the counter and printed menus that were always out of date.',
        result: 'Switched to QR ordering — guests scan, order, and pay from their tables.',
        metric: '+28%',
        metricLabel: 'average order value',
        quote: 'Customers love scanning the QR menu. Our table turnover and average bill both went up.',
        person: 'Shrutika Gurung, Cafe Owner',
    },
    {
        name: 'Spice Route',
        location: 'Pokhara',
        emoji: '🍛',
        gradient: 'from-amber-50 to-yellow-50',
        challenge: 'No visibility into ingredient costs led to silent food waste every week.',
        result: 'Recipe-based inventory now deducts stock per order with low-stock alerts.',
        metric: 'Rs. 80k',
        metricLabel: 'saved per month',
        quote: 'Inventory tracking paid for itself in the first month. We finally know our real costs.',
        person: 'Maya Tamang, Manager',
    },
    {
        name: 'Everest Dine',
        location: 'Boudha, Kathmandu',
        emoji: '🥟',
        gradient: 'from-emerald-50 to-teal-50',
        challenge: 'Manual eSewa/Khalti reconciliation took hours at the end of every day.',
        result: 'Screenshot verification confirms transfers instantly with IRD-compliant billing.',
        metric: '2 hrs',
        metricLabel: 'saved daily on billing',
        quote: 'VAT invoices generate instantly and payments verify in seconds. My accountant is thrilled.',
        person: 'Sunita Rai, Owner',
    },
]

export default function CustomerStoriesPage() {
    return (
        <div className="min-h-screen bg-surface text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-surface pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="brand">Customer Stories</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-6xl">
                        Restaurants growing with <span className="text-[var(--color-primary)]">kkkhane</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-xl font-medium leading-relaxed text-ink-subtle">
                        See how real restaurants across Nepal run smoother, waste less, and serve faster.
                    </p>
                </div>
            </section>

            {/* Stories */}
            <Section tone="band">
                <div className="grid gap-8 md:grid-cols-2">
                    {STORIES.map((s) => (
                        <article key={s.name} className="flex flex-col overflow-hidden rounded-3xl border border-hairline bg-surface shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl">
                            <div className={`flex items-center gap-4 bg-gradient-to-br ${s.gradient} p-8`}>
                                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white bg-surface/70 text-3xl shadow-sm">{s.emoji}</div>
                                <div>
                                    <h3 className="text-2xl font-extrabold text-ink">{s.name}</h3>
                                    <p className="text-sm font-medium text-ink-subtle">{s.location}</p>
                                </div>
                            </div>
                            <div className="flex flex-1 flex-col p-8">
                                <div className="mb-6 flex items-center gap-6">
                                    <div>
                                        <p className="text-3xl font-extrabold text-[var(--color-primary)]">{s.metric}</p>
                                        <p className="text-xs font-bold uppercase tracking-wide text-ink-subtle">{s.metricLabel}</p>
                                    </div>
                                </div>
                                <div className="mb-6 space-y-3 text-sm font-medium leading-relaxed text-ink-muted">
                                    <p><span className="font-bold text-ink">Challenge:</span> {s.challenge}</p>
                                    <p><span className="font-bold text-ink">Result:</span> {s.result}</p>
                                </div>
                                <blockquote className="mt-auto rounded-2xl border border-hairline bg-[#FAFAF8] p-6">
                                    <Quote size={20} className="mb-2 text-[var(--color-primary)]" />
                                    <p className="font-medium italic leading-relaxed text-ink-muted">&ldquo;{s.quote}&rdquo;</p>
                                    <p className="mt-3 text-xs font-bold text-ink">— {s.person}</p>
                                </blockquote>
                            </div>
                        </article>
                    ))}
                </div>
            </Section>

            {/* CTA */}
            <Section tone="dark">
                <div className="mx-auto max-w-2xl text-center">
                    <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                        Write your own success story
                    </h2>
                    <p className="mb-10 text-xl font-medium text-gray-300">
                        Join hundreds of restaurants across Nepal already running smarter with kkkhane.
                    </p>
                    <div className="flex flex-col justify-center gap-4 sm:flex-row">
                        <MarketingButton href="/signup" size="lg">Start Free Trial</MarketingButton>
                        <MarketingButton href="/reviews" size="lg" variant="secondary">
                            Read Reviews <ArrowRight size={18} />
                        </MarketingButton>
                    </div>
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
