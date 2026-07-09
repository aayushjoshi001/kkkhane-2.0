'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Logo from '@/components/shared/Logo'
import MobileNav from '@/app/MobileNav'
import {
    ChevronDown, FileText, LayoutGrid, PiggyBank, QrCode, Gift,
    Clock, Globe, MessageCircle, Users2, ArrowLeft
} from 'lucide-react'
import { usePathname } from 'next/navigation'

const FEATURE_LINKS = [
    { title: 'Order Management with KOT', desc: 'Take orders perfectly and reduce errors.', icon: FileText, href: '/features/order-management' },
    { title: 'Inventory & Waste Control', desc: 'Track real-time stock to lower food costs.', icon: LayoutGrid, href: '/features/inventory' },
    { title: 'Accounting & Expense', desc: 'Track every expense, bill, and payment.', icon: PiggyBank, href: '/features/accounting' },
    { title: 'Digital QR Menu', desc: 'Let guests scan and order without waiting.', icon: QrCode, href: '/features/qr-menu' },
    { title: 'Menu & Table Management', desc: 'Optimize seating and turn tables faster.', icon: LayoutGrid, href: '/features/table-management' },
    { title: 'Loyalty & Rewards', desc: 'Keep customers coming back for more.', icon: Gift, href: '/features/loyalty' },
]

const FEATURE_SIDE = [
    { title: 'Real-Time Sales Report', desc: 'Monitor live sales and profit analytics.', icon: Clock, href: '/features/analytics' },
    { title: 'Responsive Web App', desc: 'Works seamlessly on any web browser.', icon: Globe, href: '/features/apps' },
    { title: 'Refer & Earn', desc: 'Refer others, earn free Premium', icon: Gift, href: '/features/refer-earn' },
]

const RESOURCE_LINKS = [
    { title: 'Blog', desc: 'Blogs help you to optimize your restaurant', icon: FileText, href: '/blog' },
    { title: 'Reviews', desc: 'Read reviews from our customers', icon: MessageCircle, href: '/reviews' },
    { title: 'Customer Stories', desc: 'See how we are helping restaurants', icon: Users2, href: '/customer-stories' },
]

/** Shared marketing top nav (full desktop dropdowns + mobile). */
export default function MarketingNav() {
    const [scrolled, setScrolled] = useState(false)
    const pathname = usePathname()

    useEffect(() => {
        const handleScroll = () => {
            setScrolled(window.scrollY > 20)
        }
        window.addEventListener('scroll', handleScroll, { passive: true })
        handleScroll()
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    return (
        <>
            {pathname !== '/' && (
                <Link href="/" className="fixed top-[100px] left-6 z-[100] flex items-center gap-2 bg-gradient-to-r from-[#E76115] to-[#f59e0b] text-white border-transparent px-5 py-2.5 rounded-full shadow-[0_8px_30px_rgba(231,97,21,0.3)] hover:scale-105 hover:shadow-[0_8px_40px_rgba(231,97,21,0.5)] transition-all text-sm font-extrabold tracking-wide">
                    <ArrowLeft size={18} strokeWidth={3} /> BACK
                </Link>
            )}
        <nav className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 bg-surface/75 backdrop-blur-md ${scrolled ? 'shadow-md border-b border-hairline-strong' : 'border-b border-transparent'}`}>
            <div className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
                <Link href="/" className="flex shrink-0 items-center gap-2">
                    <Logo className="h-8" />
                </Link>

                <div className="hidden items-center gap-8 text-[15px] font-semibold text-ink-muted lg:flex">
                    {/* Features dropdown */}
                    <div className="group relative flex h-20 items-center">
                        <button className="flex items-center gap-1 transition-colors hover:text-[var(--color-primary)]">
                            Features <ChevronDown size={14} className="transition-transform duration-200 group-hover:-rotate-180" />
                        </button>
                        <div className="invisible absolute left-1/2 top-[80px] flex w-[800px] -translate-x-1/2 gap-6 rounded-2xl border border-hairline bg-surface p-6 opacity-0 shadow-xl transition-all duration-200 group-hover:visible group-hover:opacity-100">
                            <div className="grid flex-1 grid-cols-2 gap-4">
                                {FEATURE_LINKS.map(({ title, desc, icon: Icon, href }) => (
                                    <Link href={href} key={title} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-surface-muted">
                                        <Icon className="mt-1 text-ink-subtle shrink-0" size={18} />
                                        <div>
                                            <h4 className="mb-0.5 text-sm font-bold text-ink">{title}</h4>
                                            <p className="text-xs leading-snug text-ink-subtle">{desc}</p>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                            <div className="flex w-[280px] flex-col gap-4 border-l border-hairline pl-6">
                                {FEATURE_SIDE.map(({ title, desc, icon: Icon, href }) => (
                                    <Link href={href} key={title} className="flex gap-3 transition-colors hover:text-[var(--color-primary)]">
                                        <Icon className="mt-0.5 text-ink-subtle shrink-0" size={18} />
                                        <div>
                                            <h4 className="mb-0.5 text-sm font-bold">{title}</h4>
                                            <p className="text-xs text-ink-subtle">{desc}</p>
                                        </div>
                                    </Link>
                                ))}
                                <Link href="/signup" className="mt-auto block rounded-xl bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
                                    <h4 className="mb-4 pr-10 text-sm font-bold text-ink">Digital QR Menu to make your Cafe or Restaurant smart.</h4>
                                    <span className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-bold text-white">Start for free</span>
                                </Link>
                            </div>
                        </div>
                    </div>

                    {/* Resources dropdown */}
                    <div className="group relative flex h-20 items-center">
                        <button className="flex items-center gap-1 transition-colors hover:text-[var(--color-primary)]">
                            Resources <ChevronDown size={14} className="transition-transform duration-200 group-hover:-rotate-180" />
                        </button>
                        <div className="invisible absolute left-0 top-[80px] w-[300px] rounded-2xl border border-hairline bg-surface p-3 opacity-0 shadow-xl transition-all duration-200 group-hover:visible group-hover:opacity-100">
                            {RESOURCE_LINKS.map(({ title, desc, icon: Icon, href }) => (
                                <Link href={href} key={title} className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-surface-muted">
                                    <Icon className="mt-0.5 text-[var(--color-primary)] shrink-0" size={18} />
                                    <div>
                                        <h4 className="mb-0.5 text-sm font-bold text-ink">{title}</h4>
                                        <p className="text-xs text-ink-subtle">{desc}</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </div>

                    <Link href="/pricing" className="transition-colors hover:text-[var(--color-primary)]">Pricing</Link>
                    <Link href="/career" className="transition-colors hover:text-[var(--color-primary)]">Career</Link>
                    <Link href="/contact" className="transition-colors hover:text-[var(--color-primary)]">Contact</Link>
                </div>

                <div className="flex items-center gap-6">
                    <Link href="/login" className="hidden font-bold text-ink-muted transition-colors hover:text-[var(--color-primary)] sm:block">
                        Login
                    </Link>
                    <Link href="/signup" className="rounded-full bg-[var(--color-primary)] px-6 py-2.5 font-bold text-white shadow-md transition-transform hover:scale-105 hover:shadow-lg">
                        Start For Free
                    </Link>
                    <MobileNav />
                </div>
            </div>
        </nav>
        </>
    )
}
