import { Star, Globe } from 'lucide-react'
import { MarketingNav, MarketingFooter, Section, SectionHeading, Eyebrow, MarketingButton } from '@/components/marketing'
import RandomStatCounter from '@/components/shared/RandomStatCounter'

const REVIEWS = [
    { name: 'Prakash Shrestha', role: 'Owner', platform: 'Google', text: 'I have been using this app since a year now. I like all features. It is simple to setup and it helps me to take orders from customers. The main features I liked of this app is, <highlight>customer can scan qr code and order from their phone which is best... UI is nice</highlight>' },
    { name: 'Shrutika Gurung', role: 'Cafe Owner', platform: 'Google', text: 'As a cafe owner in Nepal, kkkhane has been a game-changer for my daily operations. Order taking, billing, stock tracking — sabai kura ekdam sajilo bhayo. <highlight>Customers love the QR menu, and the support team is quick and friendly.</highlight> Perfect software for Nepali restaurants!' },
    { name: 'Raj Kumar Gurung', role: 'Owner', platform: 'Google', text: 'The dashboard is clean and easy to understand. <highlight>I love how I can see daily reports and trends at a glance.</highlight> Really helps me plan ahead.' },
    { name: 'Darshan Thapa', role: 'Owner', platform: 'Google', text: "I've been using this POS software for my two cafés, and it's been a great experience so far. The system is <highlight>easy to use, with a clean and minimal interface that makes daily operations smooth and efficient.</highlight>" },
    { name: 'Celina Dangol', role: 'Owner', platform: 'AppStore', text: "What I love most is I don't need extra hardware. <highlight>I can manage everything on my phone.</highlight> It's the most flexible restaurant management software in Nepal." },
    { name: 'Anup Gautam', role: 'Owner', platform: 'Google', text: '<highlight>No more paper menus or miscommunication.</highlight> Our customers love the QR code menu and easy ordering. It keeps everything digital and efficient.' },
    { name: 'Maya Tamang', role: 'Restaurant Manager', platform: 'Google', text: 'Inventory tracking alone has paid for the subscription. <highlight>We cut food waste dramatically</highlight> and always know what to reorder.' },
    { name: 'Bibek Lama', role: 'Owner', platform: 'AppStore', text: 'Setup took less than an evening. <highlight>The KDS keeps my kitchen perfectly in sync</highlight> even on the busiest Friday nights.' },
    { name: 'Sunita Rai', role: 'Cafe Owner', platform: 'Google', text: 'IRD-compliant billing was the reason I switched. <highlight>VAT invoices are generated instantly</highlight> and my accountant is happy.' },
]

const STATS = [
    { value: <RandomStatCounter suffix="+" />, label: 'Restaurants' },
    { value: <RandomStatCounter suffix="★" />, label: 'Average rating' },
    { value: <RandomStatCounter suffix="M+" />, label: 'Orders processed' },
    { value: <RandomStatCounter suffix="%" />, label: 'Uptime' },
]

function renderText(text: string) {
    return {
        __html: text.replace(
            /<highlight>(.*?)<\/highlight>/g,
            '<span class="rounded bg-pink-100 px-1.5 py-0.5 font-bold text-ink shadow-sm">$1</span>',
        ),
    }
}

export default function ReviewsPage() {
    return (
        <div className="min-h-screen bg-surface text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-surface pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-primary)]/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="purple">Loved across Nepal</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-6xl">
                        Hear from Our <span className="text-[var(--color-primary)]">Happy Users</span>
                    </h1>
                    <p className="mx-auto mt-6 max-w-2xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Stories, feedback, and experiences shared by businesses growing with kkkhane.
                    </p>
                </div>
            </section>

            {/* Stats */}
            <Section tone="white" size="md" className="pt-0">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                    {STATS.map((s) => (
                        <div key={s.label} className="rounded-3xl border border-hairline bg-surface p-8 text-center shadow-sm">
                            <p className="text-3xl font-extrabold text-ink md:text-4xl">{s.value}</p>
                            <p className="mt-1 text-sm font-medium text-ink-subtle">{s.label}</p>
                        </div>
                    ))}
                </div>
            </Section>

            {/* Reviews marquee */}
            <Section tone="band">
                <SectionHeading
                    eyebrow="Reviews"
                    title="What restaurants say about kkkhane"
                    subtitle="Real reviews from owners and managers running their floors with kkkhane every day."
                />
                
                <style>{`
                    @keyframes marquee-vertical {
                        from { transform: translateY(0%); }
                        to { transform: translateY(-50%); }
                    }
                    .animate-marquee-vertical {
                        animation: marquee-vertical 8s linear infinite;
                    }
                    .animate-marquee-vertical:hover {
                        animation-play-state: paused;
                    }
                `}</style>
                
                <div className="relative h-[800px] overflow-hidden rounded-[2.5rem] border border-hairline bg-surface p-6 shadow-sm">
                    {/* Fade gradients */}
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-surface to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-gradient-to-t from-surface to-transparent" />
                    
                    <div className="columns-1 gap-6 md:columns-2 lg:columns-3 animate-marquee-vertical pb-6">
                        {[...REVIEWS, ...REVIEWS].map((r, i) => (
                            <div key={i} className="mb-6 break-inside-avoid rounded-3xl border border-hairline bg-white p-8 shadow-sm transition-shadow hover:shadow-md">
                                <div className="mb-6 flex items-start justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 text-lg font-bold uppercase text-ink-muted">
                                            {r.name.substring(0, 2)}
                                        </div>
                                        <div>
                                            <h5 className="font-bold text-ink">{r.name}</h5>
                                            <p className="text-xs text-ink-subtle">{r.role}</p>
                                        </div>
                                    </div>
                                    <Globe size={20} className="text-blue-500" />
                                </div>
                                <div className="mb-4 flex gap-1 text-amber-400">
                                    {[...Array(5)].map((_, idx) => <Star key={idx} size={16} fill="currentColor" />)}
                                </div>
                                <p className="font-medium leading-relaxed text-ink-muted" dangerouslySetInnerHTML={renderText(r.text)} />
                            </div>
                        ))}
                    </div>
                </div>
            </Section>

            {/* CTA */}
            <Section tone="dark">
                <div className="mx-auto max-w-2xl text-center">
                    <h2 className="mb-6 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
                        Join thousands of happy restaurants
                    </h2>
                    <p className="mb-10 text-xl font-medium text-gray-300">
                        Start your free trial today and see why owners across Nepal switched to kkkhane.
                    </p>
                    <MarketingButton href="/signup" size="lg" arrow>Start Free Trial</MarketingButton>
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
