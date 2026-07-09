import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { MarketingNav, MarketingFooter, Section, Eyebrow } from '@/components/marketing'

const DOCS = [
    { id: 1, title: 'Getting Started', description: 'Set up your restaurant account and create your first menu in 5 minutes.' },
    { id: 2, title: 'Menu Management', description: 'Learn how to create menu items, categories, modifiers, and manage pricing.' },
    { id: 3, title: 'Kitchen Display System', description: 'Guide for kitchen staff on managing orders and updating order status.' },
    { id: 4, title: 'Staff Management', description: 'Create user accounts, assign roles, and manage staff permissions.' },
    { id: 5, title: 'Payments & Billing', description: 'Accept payments, verify transactions, and manage billing.' },
    { id: 6, title: 'Analytics & Reports', description: 'Track revenue, orders, and generate detailed business reports.' },
]

export default function DocsPage() {
    return (
        <div className="min-h-screen bg-transparent text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-transparent pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="brand">Help Center</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-7xl">
                        Documentation
                    </h1>
                    <p className="mx-auto mt-8 max-w-2xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Complete guides to set up, manage, and scale your restaurant with kkkhane. Everything you need to know, in one place.
                    </p>
                </div>
            </section>

            {/* Docs grid */}
            <Section tone="band">
                <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
                    {DOCS.map((doc) => (
                        <Link key={doc.id} href="#"
                            className="group relative overflow-hidden rounded-3xl border border-hairline bg-surface p-8 transition-all duration-300 hover:-translate-y-1 hover:border-[var(--color-primary)]/30 hover:shadow-xl">
                            <div className="absolute right-0 top-0 h-32 w-32 rounded-full bg-[var(--color-primary)]/5 blur-2xl transition-colors group-hover:bg-[var(--color-primary)]/10" />
                            <h3 className="relative z-10 mb-3 text-2xl font-extrabold text-ink transition-colors group-hover:text-[var(--color-primary)]">
                                {doc.title}
                            </h3>
                            <p className="relative z-10 mb-6 text-lg font-medium leading-relaxed text-ink-subtle">{doc.description}</p>
                            <div className="relative z-10 inline-flex items-center text-sm font-bold text-[var(--color-primary)]">
                                Read Guide <ChevronRight size={16} className="ml-1 transition-transform group-hover:translate-x-1" />
                            </div>
                        </Link>
                    ))}
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
