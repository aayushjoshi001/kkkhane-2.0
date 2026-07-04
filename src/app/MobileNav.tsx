'use client'

import { useState, useEffect } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'

const NAV_LINKS = [
    { href: '#features', label: 'Features' },
    { href: '#how-it-works', label: 'How it Works' },
    { href: '#pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
]

export default function MobileNav() {
    const [open, setOpen] = useState(false)

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
                className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-colors"
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
                className={`fixed top-14 sm:top-16 left-0 right-0 z-50 md:hidden bg-white border-b border-gray-200 shadow-xl transition-all duration-300 ease-in-out ${
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
                            className="flex items-center px-4 py-3 text-base font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors"
                        >
                            {link.label}
                        </a>
                    ))}
                    <hr className="my-2 border-gray-100" />
                    <Link
                        href="/login"
                        onClick={() => setTimeout(() => setOpen(false), 150)}
                        className="flex items-center px-4 py-3 text-base font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-colors"
                    >
                        Staff Login
                    </Link>
                    <Link
                        href="#pricing"
                        onClick={() => setTimeout(() => setOpen(false), 150)}
                        className="flex items-center justify-center mt-2 px-4 py-3 text-base font-semibold text-white bg-[var(--color-primary)] rounded-xl hover:opacity-90 transition-all"
                    >
                        Get Started
                    </Link>
                </nav>
            </div>
        </>
    )
}
