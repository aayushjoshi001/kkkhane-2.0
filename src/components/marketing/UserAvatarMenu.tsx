'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { LayoutDashboard, LogOut, ChevronDown } from 'lucide-react'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { generatedAvatar, isGeneratedAvatar } from '@/lib/avatar'

export interface NavUser {
    fullName: string
    email: string
    avatarUrl: string | null
    dashboardHref: string
}

/** Generated fallback avatar — same DiceBear style the AdminSidebar uses. */
export function avatarFor(user: NavUser): string {
    return user.avatarUrl || generatedAvatar(user.fullName || user.email || 'user')
}

/**
 * Logged-in identity for the marketing nav: an avatar button that opens a menu
 * with the user's name/email, a link to their role dashboard, and sign out.
 * Rendered in place of the Login / Start Free buttons once /api/me confirms a
 * session.
 */
export default function UserAvatarMenu({ user }: { user: NavUser }) {
    const [open, setOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const router = useRouter()
    const ref = useRef<HTMLDivElement>(null)

    const name = user.fullName || user.email

    // A stored avatar_url (typically a Google OAuth photo) can 403 when the
    // optimizer fetches it server-side, or fail offline — either way next/image
    // would render the broken-image glyph. On error, fall back to the generated
    // DiceBear avatar, which is served unoptimized and reliably resolves.
    const [avatarFailed, setAvatarFailed] = useState(false)
    const avatarSrc = avatarFailed
        ? generatedAvatar(user.fullName || user.email || 'user')
        : avatarFor(user)

    // Close on outside click / Escape.
    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    const handleSignOut = async () => {
        setSigningOut(true)
        await signOutAndRedirect(router)
    }

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((o) => !o)}
                className="flex items-center gap-1.5 rounded-full border border-hairline bg-surface/70 py-1 pl-1 pr-2 transition-colors hover:bg-surface"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Account menu"
            >
                <Image
                    src={avatarSrc}
                    alt={name}
                    width={32}
                    height={32}
                    unoptimized={isGeneratedAvatar(avatarSrc)}
                    onError={() => { if (!isGeneratedAvatar(avatarSrc)) setAvatarFailed(true) }}
                    className="h-8 w-8 rounded-full object-cover"
                />
                <ChevronDown
                    size={14}
                    className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-[calc(100%+10px)] w-60 rounded-2xl border border-hairline bg-surface p-2 shadow-xl"
                >
                    <div className="mb-1 border-b border-hairline px-3 py-2.5">
                        <p className="truncate text-sm font-bold text-ink">{user.fullName || 'Your account'}</p>
                        <p className="truncate text-xs text-ink-subtle">{user.email}</p>
                    </div>
                    <Link
                        href={user.dashboardHref}
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
                    >
                        <LayoutDashboard size={16} className="text-ink-muted" /> Dashboard
                    </Link>
                    <button
                        role="menuitem"
                        onClick={handleSignOut}
                        disabled={signingOut}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-danger-fg transition-colors hover:bg-red-50 disabled:opacity-60"
                    >
                        <LogOut size={16} /> {signingOut ? 'Logging out…' : 'Log out'}
                    </button>
                </div>
            )}
        </div>
    )
}
