'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'

export default function NavBar({
    config,
    onMenuClick,
}: {
    config: HomepageConfig
    onMenuClick: () => void
}) {
    const name = config.restaurant_name || ''
    return (
        <nav className="sticky top-0 z-30 bg-surface/85 backdrop-blur-md border-b border-black/5">
            <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
                {/* Brand: logo + name */}
                <div className="flex items-center gap-2.5 min-w-0">
                    {config.logo_url ? (
                        <Image src={config.logo_url} alt={name || 'Logo'} width={160} height={36} className="h-9 w-auto max-w-[160px] object-contain" />
                    ) : (
                        name && <span className="font-bold text-lg truncate" style={{ color: config.theme_secondary }}>{name}</span>
                    )}
                </div>

                {/* CTA */}
                <button
                    onClick={onMenuClick}
                    className="shrink-0 px-5 py-2 rounded-full text-white text-sm font-semibold hover:opacity-90 transition active:scale-95"
                    style={{ backgroundColor: config.theme_primary }}
                >
                    View Menu
                </button>
            </div>
        </nav>
    )
}
