import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { MarketingNav, MarketingFooter, Section, Eyebrow } from '@/components/marketing'

const BLOG_POSTS = [
    { id: 1, emoji: '📱', category: 'Tips', title: 'How to Maximize QR Code Ordering', excerpt: 'Learn best practices for setting up your QR code menu to increase orders and improve customer experience.', date: 'May 20, 2024' },
    { id: 2, emoji: '💰', category: 'Business', title: 'Why Nepal QR Payments Matter', excerpt: "Understand the impact of eSewa, Khalti, and Fonepay integration on your restaurant's revenue.", date: 'May 15, 2024' },
    { id: 3, emoji: '👨‍🍳', category: 'Operations', title: 'Kitchen Display System Best Practices', excerpt: 'Tips for training your kitchen staff and optimizing KDS workflows for faster service.', date: 'May 10, 2024' },
    { id: 4, emoji: '📊', category: 'Analytics', title: 'Understanding Your kkkhane Reports', excerpt: 'A complete guide to reading Z-reports, revenue trends, and making data-driven decisions.', date: 'May 5, 2024' },
]

export default function BlogPage() {
    return (
        <div className="min-h-screen bg-surface text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-surface pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="purple">Resources &amp; Insights</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-7xl">
                        Our <span className="text-[var(--color-primary)]">Blog</span>
                    </h1>
                    <p className="mx-auto mt-8 max-w-xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Tips, insights, and stories from the kkkhane team about running restaurants in Nepal.
                    </p>
                </div>
            </section>

            {/* Blog grid */}
            <Section tone="band">
                <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                    {BLOG_POSTS.map((post) => (
                        <Link href="#" key={post.id}
                            className="group flex flex-col overflow-hidden rounded-3xl border border-hairline bg-surface transition-all duration-300 hover:-translate-y-1 hover:border-[var(--color-primary)]/30 hover:shadow-2xl">
                            <div className="relative flex h-48 items-center justify-center overflow-hidden border-b border-hairline bg-surface-muted">
                                <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/10 to-indigo-500/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                                <span className="relative z-10 text-6xl transition-transform duration-300 group-hover:scale-110">{post.emoji}</span>
                            </div>
                            <div className="flex flex-1 flex-col p-8">
                                <div className="mb-4 flex items-center justify-between">
                                    <span className="rounded-full bg-[var(--color-primary)]/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-[var(--color-primary)]">
                                        {post.category}
                                    </span>
                                    <span className="text-xs font-bold text-ink-subtle">{post.date}</span>
                                </div>
                                <h3 className="mb-3 text-2xl font-extrabold leading-snug text-ink transition-colors group-hover:text-[var(--color-primary)]">
                                    {post.title}
                                </h3>
                                <p className="mb-6 flex-1 font-medium leading-relaxed text-ink-subtle">{post.excerpt}</p>
                                <div className="flex items-center border-t border-hairline pt-6 text-sm font-bold text-[var(--color-primary)]">
                                    Read Article <ArrowRight size={16} className="ml-2 transition-transform group-hover:translate-x-1" />
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            </Section>

            <MarketingFooter />
        </div>
    )
}
