/**
 * How a booking's guest mix reads on screen.
 *
 * Bookings made before the male/female split existed carry only an `adults`
 * total, so those render as a plain count rather than a fabricated breakdown —
 * "3 adults", not "3 male". `children` has always been stored and is shown
 * whenever it is non-zero.
 */
export function describeGuestMix(booking: {
    adults?: number | null
    adult_male?: number | null
    adult_female?: number | null
    children?: number | null
}): string {
    const male = Math.max(0, Number(booking.adult_male) || 0)
    const female = Math.max(0, Number(booking.adult_female) || 0)
    const children = Math.max(0, Number(booking.children) || 0)
    const adults = Math.max(0, Number(booking.adults) || 0) || male + female

    const parts: string[] = []
    if (male || female) {
        if (male) parts.push(`${male}M`)
        if (female) parts.push(`${female}F`)
    } else if (adults) {
        parts.push(`${adults} adult${adults === 1 ? '' : 's'}`)
    }
    if (children) parts.push(`${children} child${children === 1 ? '' : 'ren'}`)

    return parts.length ? parts.join(' · ') : 'No guests recorded'
}

/** Total heads on a booking, adults and children together. */
export function totalGuests(booking: {
    adults?: number | null
    adult_male?: number | null
    adult_female?: number | null
    children?: number | null
}): number {
    const male = Math.max(0, Number(booking.adult_male) || 0)
    const female = Math.max(0, Number(booking.adult_female) || 0)
    const adults = male + female || Math.max(0, Number(booking.adults) || 0)
    return adults + Math.max(0, Number(booking.children) || 0)
}
