'use client'

import Image from 'next/image'
import { UtensilsCrossed, UserCircle, Search, X } from 'lucide-react'
import PromoBanner from '@/components/customer/PromoBanner'
import LanguageSwitcher from '@/components/customer/LanguageSwitcher'

/**
 * The branded, curved-bottom customer menu header used by both the dine-in
 * (t/[tableSlug]) and takeout menu pages: restaurant logo + name, an optional
 * language switcher, a profile button, the rotating PromoBanner, and the
 * overlapping search pill. Previously copy-pasted verbatim in both pages; kept
 * here so a layout/responsive tweak only has to happen once.
 */
export default function CustomerMenuHeader({
    logoUrl,
    restaurantName,
    eyebrow,
    searchQuery,
    onSearchChange,
    onProfileClick,
    showLanguageSwitcher = false,
}: {
    logoUrl?: string | null
    restaurantName: string
    /** Small uppercase label above the name, e.g. "Restaurant" or "Takeout". */
    eyebrow: string
    searchQuery: string
    onSearchChange: (value: string) => void
    onProfileClick: () => void
    showLanguageSwitcher?: boolean
}) {
    return (
        <header className="relative bg-brand-500 text-white rounded-b-[36px] sticky top-0 z-40 pb-6 pt-2 shadow-md flex flex-col gap-2">
            {/* Background image overlay below the brand row (starts at top-[48px]) */}
            <div className="absolute inset-x-0 bottom-0 top-[48px] rounded-b-[36px] overflow-hidden z-0">
                <div
                    className="absolute inset-0 bg-cover bg-center filter brightness-[0.55] scale-105"
                    style={{ backgroundImage: `url('https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop')` }}
                />
                <div className="absolute inset-0 bg-brand-500/15 mix-blend-multiply" />
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
            </div>

            <div className="max-w-2xl mx-auto w-full px-4 flex items-center justify-between gap-3 h-10 relative z-10">
                {/* Left: restaurant logo + name */}
                <div className="flex items-center gap-2 shrink-0">
                    {logoUrl ? (
                        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-surface shrink-0 border border-white/25 shadow-sm">
                            <Image src={logoUrl} alt={restaurantName} fill className="object-cover" sizes="32px" />
                        </div>
                    ) : (
                        <div className="w-8 h-8 rounded-full bg-surface/10 flex items-center justify-center shrink-0 border border-white/25 shadow-sm">
                            <UtensilsCrossed size={14} className="text-white" />
                        </div>
                    )}
                    <div className="flex flex-col">
                        <span className="text-[8px] text-white/70 uppercase font-black tracking-wide leading-none">{eyebrow}</span>
                        <span className="text-xs font-black tracking-tight truncate max-w-[120px] leading-tight">
                            {restaurantName}
                        </span>
                    </div>
                </div>

                {/* Right: optional language switcher, profile button, platform logo */}
                <div className="flex items-center gap-3 shrink-0 pr-1">
                    {showLanguageSwitcher && <LanguageSwitcher />}
                    <button
                        onClick={onProfileClick}
                        className="w-8 h-8 rounded-full bg-surface/10 hover:bg-surface/20 flex items-center justify-center shrink-0 border border-white/25 shadow-sm transition-colors"
                        aria-label="Open profile"
                    >
                        <UserCircle size={18} className="text-white" />
                    </button>
                    <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0 border-2 border-white overflow-hidden relative shadow-sm">
                        <Image src="/brand/kkkhane-k-logo.jpg" alt="kkkhane" fill className="object-cover scale-[1.45]" sizes="32px" priority />
                    </div>
                </div>
            </div>

            {/* Rotating featured-offer banner */}
            <div className="w-full text-center pb-1 relative z-10">
                <PromoBanner />
            </div>

            {/* Overlapping search pill at the bottom curve */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2 w-[85%] max-w-md z-30">
                <div className="relative shadow-md rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Search className="h-3.5 w-3.5 text-brand-500" />
                    </div>
                    <input
                        type="text"
                        placeholder="SEARCH FOR ITEM..."
                        value={searchQuery}
                        onChange={(e) => onSearchChange(e.target.value)}
                        className="block w-full pl-10 pr-10 py-2.5 text-[11px] border-0 rounded-full bg-brand-50 text-brand-900 placeholder-[#D68E65] font-extrabold focus:outline-none focus:ring-2 focus:ring-orange-300 focus:bg-surface transition-all text-center uppercase tracking-wider"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => onSearchChange('')}
                            className="absolute inset-y-0 right-0 pr-4 flex items-center text-brand-500 hover:text-orange-700"
                            aria-label="Clear search"
                        >
                            <X className="h-4 w-4 stroke-[3px]" />
                        </button>
                    )}
                </div>
            </div>
        </header>
    )
}
