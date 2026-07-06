'use client'

import { useState } from 'react'
import { HomepageConfig } from '@/types/database'
import HomepageRenderer from '@/components/customer/homepage/HomepageRenderer'
import { ChevronRight, ShoppingBag } from 'lucide-react'
import Link from 'next/link'

interface HomepageGateProps {
    // Fetched server-side alongside the rest of the QR-scan page's data — no
    // client round trip / loading-skeleton flash on first paint. Null means no
    // homepage is configured for this restaurant, so we skip straight to the menu.
    initialHomepageConfig: HomepageConfig | null
    onProceed: () => void
    // When set, the homepage shows a secondary "Order Takeout / Pickup" action so a
    // guest who scanned the table QR can self-order for pickup without first tapping
    // "View Menu" to reach the no-session modal. Null hides it (e.g. no slug).
    takeoutHref?: string | null
    // Function-as-child: receives a `backToHome` callback (null when there is
    // no homepage to return to) so the menu can offer a "back to homepage" action.
    children: (opts: { backToHome: (() => void) | null }) => React.ReactNode
}

export default function HomepageGate({ initialHomepageConfig, onProceed, takeoutHref, children }: HomepageGateProps) {
    const [showHomepage, setShowHomepage] = useState(!!initialHomepageConfig)

    if (!showHomepage || !initialHomepageConfig) {
        // Only offer "back to homepage" when a homepage config actually exists.
        return <>{children({ backToHome: initialHomepageConfig ? () => setShowHomepage(true) : null })}</>
    }

    return (
        <div className="min-h-screen bg-surface-muted">
            <HomepageRenderer
                config={initialHomepageConfig}
                onMenuClick={() => {
                    setShowHomepage(false)
                    onProceed()
                }}
            />
            {/* Floating CTAs — elevated above cart bar */}
            <div className="fixed bottom-6 right-4 z-50 flex flex-col items-end gap-2">
                {takeoutHref && (
                    <Link
                        href={takeoutHref}
                        className="px-5 py-2.5 bg-surface text-primary border border-primary rounded-full shadow-lg hover:bg-primary/5 flex items-center gap-2 font-semibold text-sm"
                    >
                        <ShoppingBag size={16} />
                        Takeout / Pickup
                    </Link>
                )}
                <button
                    onClick={() => {
                        setShowHomepage(false)
                        onProceed()
                    }}
                    className="px-6 py-3 bg-primary text-white rounded-full shadow-xl shadow-primary/30 hover:opacity-90 flex items-center gap-2 font-semibold text-sm"
                >
                    View Menu
                    <ChevronRight size={18} />
                </button>
            </div>
        </div>
    )
}
