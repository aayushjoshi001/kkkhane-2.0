'use client'

import { Phone } from 'lucide-react'

/**
 * Floating "Call for Service" button shown on a checked-in room's menu screen.
 * A plain tel: link so it works even if the app is offline — reception takes
 * the order and adds it to the room via the staff console.
 */
export default function RoomServiceCallButton({ phone }: { phone: string }) {
    return (
        <a
            href={`tel:${phone}`}
            aria-label="Call reception for service"
            className="fixed z-40 bottom-24 right-4 flex items-center gap-2 rounded-full bg-brand-500 text-white pl-4 pr-5 py-3 font-extrabold text-sm shadow-[0_8px_24px_rgba(251,99,3,0.4)] hover:bg-brand-400 active:scale-95 transition-all"
        >
            <Phone size={18} strokeWidth={2.5} /> Call for Service
        </a>
    )
}
