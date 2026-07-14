// Single source of truth for how each room status is presented in the UI —
// label and Tailwind classes per status. Both the admin Rooms & Suites page
// (app/(admin)/admin/rooms/RoomsClient.tsx) and the cashier room board
// (components/waiter/CashierRoomManager.tsx) render from this table; before it
// existed each kept its own copy that could silently drift apart.
//
// Note the DB check constraint (rooms_status_check) also allows a legacy
// 'blocked' value the UI never sets — the API route validating status writes
// (app/api/rooms/status/route.ts) mirrors the DB constraint, not this table.
import { CheckCircle2, Bed, Brush, Wrench, type LucideIcon } from 'lucide-react'
import type { RoomStatus } from '@/types/database'

export interface RoomStatusConfig {
    /** Guest-facing name — statuses are stored as DB words ('dirty'), shown as hotel words ('Cleaning'). */
    label: string
    icon: LucideIcon
    /** Solid status dot, e.g. the corner indicator on room cards. */
    dot: string
    /** Body text in the status color, e.g. under a room number. */
    text: string
    /** Tinted chip/badge background + text. */
    badge: string
    /** Border matching the badge tint (kept separate — some badges use the default border color). */
    badgeBorder: string
    /** Left accent stripe on admin room cards. */
    accent: string
    /** Subtle full-card tint on the cashier room board. */
    card: string
    /** Whether live views animate the status dot (occupancy is "happening now"). */
    pulse: boolean
}

export const ROOM_STATUS_CONFIG: Record<RoomStatus, RoomStatusConfig> = {
    available: {
        label: 'Available',
        icon: CheckCircle2,
        dot: 'bg-emerald-500',
        text: 'text-emerald-600',
        badge: 'bg-emerald-50 text-emerald-700',
        badgeBorder: 'border-emerald-100',
        accent: 'border-l-emerald-400',
        card: 'border-emerald-100 bg-emerald-50/10',
        pulse: false,
    },
    occupied: {
        label: 'Booked',
        icon: Bed,
        dot: 'bg-blue-500',
        text: 'text-blue-600',
        badge: 'bg-blue-50 text-blue-700',
        badgeBorder: 'border-blue-100',
        accent: 'border-l-blue-400',
        card: 'border-blue-200 bg-blue-50/10',
        pulse: true,
    },
    dirty: {
        label: 'Cleaning',
        icon: Brush,
        dot: 'bg-amber-500',
        text: 'text-amber-600',
        badge: 'bg-amber-50 text-amber-700',
        badgeBorder: 'border-amber-100',
        accent: 'border-l-amber-400',
        card: 'border-amber-200 bg-amber-50/10',
        pulse: false,
    },
    maintenance: {
        label: 'Closed',
        icon: Wrench,
        dot: 'bg-rose-500',
        text: 'text-rose-600',
        badge: 'bg-rose-50 text-rose-700',
        badgeBorder: 'border-rose-100',
        accent: 'border-l-rose-400',
        card: 'border-rose-200 bg-rose-50/10',
        pulse: false,
    },
}

// Neutral fallback for a status outside the RoomStatus type (e.g. a legacy
// 'blocked' row): renders gray with the raw status word as its label.
export function getRoomStatusConfig(status: string): RoomStatusConfig {
    return ROOM_STATUS_CONFIG[status as RoomStatus] ?? {
        label: status,
        icon: Wrench,
        dot: 'bg-gray-400',
        text: 'text-gray-500',
        badge: 'bg-gray-50 text-gray-700',
        badgeBorder: 'border-gray-100',
        accent: 'border-l-gray-300',
        card: 'border-gray-200 bg-gray-50/10',
        pulse: false,
    }
}
