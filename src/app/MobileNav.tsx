'use client'

import { useState, useEffect } from 'react'
import { Menu, X, LayoutDashboard, LogOut } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { avatarFor, type NavUser } from '@/components/marketing/UserAvatarMenu'

const NAV_LINKS = [
    { href: '/#features', label: 'Features' },
    { href: '/#how-it-works', label: 'How it Works' },
    { href: '/#pricing', label: 'Pricing' },
    { href: '/#faq', label: 'FAQ' },
]

export default function MobileNav({ user = null }: { user?: NavUser | null }) {
    const [open, setOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const router = useRouter()

    const handleSignOut = async () => {
        setSigningOut(true)
        await signOutAndRedirect(router)
    }

    // Lock body scroll when menu is open
    useEffect(() => {
        if (open) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => {
            document.body.style.overflow = ''
        }
    }, [open])

    // Close on escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [])

    return (
        <>
            {/* Hamburger button — visible only on mobile */}
            <button
                onClick={() => setOpen(!open)}
                className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-surface-muted transition-colors"
                aria-label={open ? 'Close menu' : 'Open menu'}
                aria-expanded={open}
            >
                {open ? <X size={22} /> : <Menu size={22} />}
            </button>

            {/* Overlay */}
            {open && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
                    onClick={() => setOpen(false)}
                    aria-hidden="true"
                />
            )}

            {/* Slide-down mobile menu */}
            <div
                className={`fixed top-14 sm:top-16 left-0 right-0 z-50 md:hidden bg-surface border-b border-hairline-strong shadow-xl transition-all duration-300 ease-in-out ${
                    open
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 -translate-y-4 pointer-events-none'
                }`}
            >
                <nav className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
                    {NAV_LINKS.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            onClick={() => setTimeout(() => setOpen(false), 150)}
                            className="flex items-center px-4 py-3 text-base font-medium text-ink-muted hover:text-ink hover:bg-surface-muted rounded-xl transition-colors"
                        >
                            {link.label}
                        </a>
                    ))}
                    <hr className="my-2 border-hairline" />
                    {user ? (
                        <>
                            <div className="flex items-center gap-3 px-4 py-3">
                                <Image
                                    src={avatarFor(user)}
                                    alt={user.fullName || user.email}
                                    width={40}
                                    height={40}
                                    unoptimized
                                    className="h-10 w-10 rounded-full object-cover"
                                />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-bold text-ink">{user.fullName || 'Your account'}</p>
                                    <p className="truncate text-xs text-ink-subtle">{user.email}</p>
                                </div>
                            </div>
                            <Link
                                href={user.dashboardHref}
                                onClick={() => setTimeout(() => setOpen(false), 150)}
                                className="flex items-center gap-2.5 px-4 py-3 text-base font-medium text-ink-muted hover:text-ink hover:bg-surface-muted rounded-xl transition-colors"
                            >
                                <LayoutDashboard size={18} /> Dashboard
                            </Link>
                            <button
                                onClick={handleSignOut}
                                disabled={signingOut}
                                className="flex items-center gap-2.5 px-4 py-3 text-base font-medium text-danger-fg hover:bg-red-50 rounded-xl transition-colors disabled:opacity-60"
                            >
                                <LogOut size={18} /> {signingOut ? 'Logging out…' : 'Log out'}
                            </button>
                        </>
                    ) : (
                        <>
                            <Link
                                href="/login"
                                onClick={() => setTimeout(() => setOpen(false), 150)}
                                className="flex items-center px-4 py-3 text-base font-medium text-ink-muted hover:text-ink hover:bg-surface-muted rounded-xl transition-colors"
                            >
                                Staff Login
                            </Link>
                            <Link
                                href="/#pricing"
                                onClick={() => setTimeout(() => setOpen(false), 150)}
                                className="flex items-center justify-center mt-2 px-4 py-3 text-base font-semibold text-white bg-brand-500 rounded-xl hover:bg-brand-600 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)]"
                            >
                                Get Started
                            </Link>
                        </>
                    )}
                </nav>
            </div>
        </>
    )
}
