import Link from 'next/link'
import Logo from '@/components/shared/Logo'
import CopyrightYear from '@/components/shared/CopyrightYear'
import {
    Phone, MapPin,
    Facebook, Instagram, Youtube, Twitter,
} from 'lucide-react'

const SOCIALS = [
    { icon: Facebook, url: 'https://facebook.com/kkkhane' },
    { icon: Instagram, url: 'https://instagram.com/kkkhane' },
    { icon: Youtube, url: 'https://youtube.com/@kkkhane' },
    { icon: Twitter, url: 'https://twitter.com/kkkhane' },
]

const FEATURE_LINKS = [
    { label: 'Order Management with KOT', href: '/features/order-management' },
    { label: 'Inventory & Waste Control', href: '/features/inventory' },
    { label: 'Accounting & Expense Manager', href: '/features/accounting' },
    { label: 'Digital QR Menu', href: '/features/qr-menu' },
    { label: 'Menu & Table Management', href: '/features/table-management' },
    { label: 'Real Time Sales Report', href: '/features/analytics' },
    { label: 'Loyalty & Rewards', href: '/features/loyalty' },
    { label: 'Refer & Earn', href: '/features/refer-earn' },
]

const RESOURCE_LINKS: { label: string; href: string }[] = [
    { label: 'Blogs', href: '/blog' },
    { label: 'Contact Us', href: '/contact' },
    { label: 'Reviews', href: '/reviews' },
    { label: 'Customer Stories', href: '/customer-stories' },
]

/** Shared marketing footer (links, contact band, app badges). */
export default function MarketingFooter() {
    return (
        <footer className="border-t border-hairline-strong bg-[#f9fafb] pb-10 pt-20">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
                <div className="mb-16 grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <Logo className="mb-6 h-8" />
                        <p className="mb-8 text-sm font-medium leading-relaxed text-ink-subtle">
                            #1 Software to manage and grow your cafe or restaurant — smarter, faster.
                        </p>
                        <div className="flex gap-3">
                            {SOCIALS.map(({ icon: Icon, url }) => (
                                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                                   className="flex h-10 w-10 items-center justify-center rounded-full border border-hairline-strong bg-surface text-ink-muted shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                                    <Icon size={18} />
                                </a>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="mb-6 text-lg font-bold text-ink">Features</h4>
                        <ul className="space-y-4">
                            {FEATURE_LINKS.map(({ label, href }) => (
                                <li key={href}>
                                    <Link href={href} className="text-sm font-medium text-ink-muted transition-colors hover:text-[var(--color-primary)]">{label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-6 text-lg font-bold text-ink">Resources</h4>
                        <ul className="space-y-4">
                            {RESOURCE_LINKS.map(({ label, href }) => (
                                <li key={label}>
                                    <Link href={href} className="text-sm font-medium text-ink-muted transition-colors hover:text-[var(--color-primary)]">{label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                </div>

                {/* Contact band */}
                <div className="mb-12 rounded-3xl border border-hairline bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 p-8 shadow-sm sm:p-10">
                    <div className="mb-8">
                        <h3 className="mb-2 flex items-center gap-2 text-2xl font-extrabold text-ink">Get in Touch 👋</h3>
                        <p className="font-medium text-ink-muted">Ready to transform your restaurant? Contact our team today.</p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3">
                        <div className="rounded-2xl border border-white bg-surface/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-blue-600"><Phone size={18} /> Sales & Support</div>
                            <p className="mb-2 text-sm font-bold text-ink">+977 9765662427</p>
                            <p className="text-sm font-bold text-ink">info.kkkhane@gmail.com</p>
                        </div>
                        <div className="rounded-2xl border border-white bg-surface/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-green-600"><Phone size={18} /> General Inquiry</div>
                            <p className="mb-2 text-sm font-bold text-ink">+977 9765662427</p>
                            <p className="text-sm font-bold text-ink">info.kkkhane@gmail.com</p>
                        </div>
                        <div className="rounded-2xl border border-white bg-surface/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-[var(--color-primary)]"><MapPin size={18} /> Headquarters</div>
                            <p className="text-sm font-medium leading-relaxed text-ink-muted">
                                Bhojad, Bharatpur, Nepal <br/>
                                Serving Cafe and Restaurants nationwide.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-center justify-between gap-4 border-t border-hairline-strong pt-8 text-sm font-medium text-ink-subtle sm:flex-row">
                    <div className="flex gap-6">
                        <Link href="/legal/refund" className="transition-colors hover:text-ink">Refund</Link>
                        <Link href="/legal/privacy" className="transition-colors hover:text-ink">Privacy Policy</Link>
                        <Link href="/legal/terms" className="transition-colors hover:text-ink">Terms &amp; Conditions</Link>
                    </div>
                    <p>&copy; <CopyrightYear /> KKKhane. All Rights Reserved.</p>
                </div>
            </div>
        </footer>
    )
}
