import { BedDouble } from 'lucide-react'

/**
 * Shown when a room's QR is scanned but nobody is checked in to that room.
 * Ordering is blocked here rather than at checkout so a guest never builds a
 * cart for an order that could never be billed to a stay.
 */
export default function RoomNotCheckedIn({
    roomNumber,
    restaurantName,
}: {
    roomNumber: string
    restaurantName?: string
}) {
    return (
        <main className="min-h-dvh flex items-center justify-center bg-surface-muted px-6 py-16">
            <div className="w-full max-w-md text-center flex flex-col items-center gap-5">
                <div className="w-16 h-16 rounded-2xl bg-brand-100 text-brand-600 grid place-items-center">
                    <BedDouble size={28} />
                </div>

                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-extrabold text-ink tracking-tight">
                        Room {roomNumber} isn&apos;t checked in yet
                    </h1>
                    <p className="text-[15px] text-ink-subtle font-medium leading-relaxed">
                        In-room ordering opens once the front desk checks a guest into this room.
                        If you&apos;ve already arrived, please contact reception and they&apos;ll
                        get you set up.
                    </p>
                </div>

                {restaurantName && (
                    <p className="text-xs font-bold text-ink-muted uppercase tracking-widest mt-2">
                        {restaurantName}
                    </p>
                )}
            </div>
        </main>
    )
}
