'use client'

import { useState, useEffect } from 'react'

// Rotating featured-offer banner shown in the branded header of both the dine-in
// (t/[tableSlug]) and takeout menu pages. Kept here so the two don't carry
// their own copy of the same markup + promo list.
const PROMOS = [
    { id: 1, text: "🔥 Flat 10% off on all items! Use code: FLAT10", bg: "from-orange-500 to-amber-500", textCol: "text-white" },
    { id: 2, text: "🎉 Free drink on orders above Rs. 1,000!", bg: "from-red-500 to-rose-500", textCol: "text-white" },
    { id: 3, text: "✨ Happy hour combo deals live now!", bg: "from-indigo-600 to-purple-600", textCol: "text-white" },
]

export default function PromoBanner() {
    const [current, setCurrent] = useState(0)
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent(c => (c + 1) % PROMOS.length)
        }, 4000)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="h-16 relative w-full overflow-hidden flex items-center justify-center">
            {PROMOS.map((p, idx) => (
                <div
                    key={p.id}
                    className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-all duration-700 ${
                        idx === current
                            ? 'opacity-100 translate-y-0 scale-100'
                            : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
                    }`}
                >
                    <span className="text-[10px] text-orange-300 uppercase tracking-widest font-black mb-1 drop-shadow-sm">Featured Offer</span>
                    <p className="text-white text-xs font-black drop-shadow-md leading-snug max-w-[280px] uppercase tracking-wide">
                        {p.text}
                    </p>
                </div>
            ))}
        </div>
    )
}
