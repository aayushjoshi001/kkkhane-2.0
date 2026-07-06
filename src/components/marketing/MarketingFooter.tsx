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
        <footer className="border-t border-gray-200 bg-[#f9fafb] pb-10 pt-20">
            <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8">
                <div className="mb-16 grid grid-cols-1 gap-12 md:grid-cols-2 lg:grid-cols-4">
                    <div>
                        <Logo className="mb-6 h-8" />
                        <p className="mb-8 text-sm font-medium leading-relaxed text-gray-500">
                            #1 Restaurant Software to manage and grow your restaurant — smarter, faster.
                        </p>
                        <div className="flex gap-3">
                            {SOCIALS.map(({ icon: Icon, url }) => (
                                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                                   className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                                    <Icon size={18} />
                                </a>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="mb-6 text-lg font-bold text-gray-900">Features</h4>
                        <ul className="space-y-4">
                            {FEATURE_LINKS.map(({ label, href }) => (
                                <li key={href}>
                                    <Link href={href} className="text-sm font-medium text-gray-600 transition-colors hover:text-[var(--color-primary)]">{label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-6 text-lg font-bold text-gray-900">Resources</h4>
                        <ul className="space-y-4">
                            {RESOURCE_LINKS.map(({ label, href }) => (
                                <li key={label}>
                                    <Link href={href} className="text-sm font-medium text-gray-600 transition-colors hover:text-[var(--color-primary)]">{label}</Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                </div>

                {/* Contact band */}
                <div className="mb-12 rounded-3xl border border-gray-100 bg-gradient-to-r from-indigo-50 via-purple-50 to-pink-50 p-8 shadow-sm sm:p-10">
                    <div className="mb-8">
                        <h3 className="mb-2 flex items-center gap-2 text-2xl font-extrabold text-gray-900">Get in Touch 👋</h3>
                        <p className="font-medium text-gray-600">Ready to transform your restaurant? Contact our team today.</p>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3">
                        <div className="rounded-2xl border border-white bg-white/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-blue-600"><Phone size={18} /> Sales Team</div>
                            <p className="mb-2 text-sm font-bold text-gray-900">+977 9800000000</p>
                            <p className="text-sm font-bold text-gray-900">sales@kkkhane.com</p>
                        </div>
                        <div className="rounded-2xl border border-white bg-white/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-green-600"><Phone size={18} /> Support Team</div>
                            <p className="mb-2 text-sm font-bold text-gray-900">+977 9800000000</p>
                            <p className="text-sm font-bold text-gray-900">support@kkkhane.com</p>
                        </div>
                        <div className="rounded-2xl border border-white bg-white/80 p-6 shadow-sm backdrop-blur">
                            <div className="mb-4 flex items-center gap-2 font-bold text-[var(--color-primary)]"><MapPin size={18} /> Service Location</div>
                            <p className="text-sm font-medium leading-relaxed text-gray-600">
                                We provide comprehensive restaurant management solutions across all regions of Nepal.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col items-center justify-between gap-4 border-t border-gray-200 pt-8 text-sm font-medium text-gray-500 sm:flex-row">
                    <div className="flex gap-6">
                        <Link href="/legal/refund" className="transition-colors hover:text-gray-900">Refund</Link>
                        <Link href="/legal/privacy" className="transition-colors hover:text-gray-900">Privacy Policy</Link>
                        <Link href="/legal/terms" className="transition-colors hover:text-gray-900">Terms &amp; Conditions</Link>
                    </div>
                    <p>&copy; <CopyrightYear /> kkkhane. All Rights Reserved.</p>
                </div>
            </div>
        </footer>
    )
}
