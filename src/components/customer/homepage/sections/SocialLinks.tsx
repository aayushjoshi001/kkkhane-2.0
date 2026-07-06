'use client'
import { HomepageConfig } from '@/types/database'

// Brand SVG icons (lucide dropped brand glyphs, so we inline them).
const ICONS: Record<string, React.ReactNode> = {
    facebook: (
        <path d="M9.198 21.5h4v-8.01h3.604l.396-3.98h-4V7.5a1 1 0 0 1 1-1h3v-4h-3a5 5 0 0 0-5 5v2.01h-2l-.396 3.98h2.396v8.01Z" />
    ),
    instagram: (
        <>
            <rect x="2.5" y="2.5" width="19" height="19" rx="5" ry="5" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
            <circle cx="17.5" cy="6.5" r="1.5" />
        </>
    ),
    whatsapp: (
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.24.68-1.42 1.32-1.95 1.36-.5.04-.97.23-3.27-.68-2.76-1.09-4.5-3.92-4.64-4.1-.13-.18-1.11-1.48-1.11-2.82s.7-2 .95-2.27c.24-.27.53-.34.7-.34.18 0 .35 0 .5.01.16.01.38-.06.59.45.24.57.81 1.97.88 2.11.07.14.12.31.02.49-.09.18-.14.29-.27.45-.14.16-.29.36-.41.48-.14.14-.28.29-.12.56.16.27.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.21 1.37.27.14.43.12.59-.07.16-.18.68-.79.86-1.06.18-.27.36-.23.61-.14.25.09 1.6.76 1.87.9.27.14.45.2.52.32.07.12.07.68-.17 1.36Z" />
    ),
    tiktok: (
        <path d="M16.5 2h-3v13.2a2.7 2.7 0 1 1-2.7-2.7c.27 0 .53.04.78.11V9.5a5.9 5.9 0 0 0-.78-.05A5.7 5.7 0 1 0 16.5 15V8.6a7.3 7.3 0 0 0 4.3 1.4V7a4.3 4.3 0 0 1-4.3-4.3V2Z" />
    ),
}

const LABELS: Record<string, string> = {
    facebook: 'Facebook',
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    tiktok: 'TikTok',
}

/** Normalises a raw value into a usable href (handles whatsapp numbers & bare handles). */
function toHref(platform: string, value: string): string {
    const v = value.trim()
    if (!v) return ''
    if (/^https?:\/\//i.test(v)) return v
    if (platform === 'whatsapp') {
        const digits = v.replace(/[^\d]/g, '')
        return digits ? `https://wa.me/${digits}` : ''
    }
    const handle = v.replace(/^@/, '')
    const base: Record<string, string> = {
        facebook: 'https://facebook.com/',
        instagram: 'https://instagram.com/',
        tiktok: 'https://tiktok.com/@',
    }
    return base[platform] ? base[platform] + handle : v
}

export default function SocialLinks({
    social,
    className = '',
    iconClassName = 'w-5 h-5',
}: {
    social: HomepageConfig['social']
    className?: string
    iconClassName?: string
}) {
    if (!social) return null
    const entries = (['facebook', 'instagram', 'whatsapp', 'tiktok'] as const)
        .map((p) => ({ platform: p, href: toHref(p, social[p] || '') }))
        .filter((e) => e.href)

    if (entries.length === 0) return null

    return (
        <div className={`flex items-center gap-3 ${className}`}>
            {entries.map(({ platform, href }) => (
                <a
                    key={platform}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={LABELS[platform]}
                    title={LABELS[platform]}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-surface/10 hover:bg-surface/20 transition"
                >
                    <svg viewBox="0 0 24 24" fill="currentColor" className={iconClassName}>
                        {ICONS[platform]}
                    </svg>
                </a>
            ))}
        </div>
    )
}
