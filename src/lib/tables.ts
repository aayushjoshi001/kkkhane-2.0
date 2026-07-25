import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'

export interface TableByToken {
    id: string
    restaurant_id: string
    room_id: string | null
    label: string
    restaurants: { name: string; slug: string | null; logo_url: string | null; physical_menu_urls: string[] | null } | null
}

/**
 * Resolves a table by its QR token, memoized per request via React.cache().
 *
 * The same qr_token was previously looked up separately (and uncached) in
 * layout.tsx, page.tsx's generateMetadata, page.tsx's main render, and
 * checkout/page.tsx — up to 4 identical round-trips for one page load.
 * React.cache() dedupes calls with the same argument within a single render
 * pass, so every caller below now shares one query.
 */
export const getTableByToken = cache(async (qrToken: string): Promise<TableByToken | null> => {
    if (!qrToken) return null
    const supabase = await createAdminClient()

    // 1. Primary lookup by exact qr_token
    const { data } = await supabase
        .from('tables')
        .select('id, restaurant_id, room_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
        .eq('qr_token', qrToken)
        .maybeSingle()

    if (data) {
        return {
            id: data.id,
            restaurant_id: data.restaurant_id,
            room_id: data.room_id,
            label: data.label,
            restaurants: Array.isArray(data.restaurants) ? data.restaurants[0] || null : (data.restaurants as unknown as TableByToken['restaurants']),
        }
    }

    // 2. Fallback: If qrToken is a UUID (table_id or room_id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(qrToken)
    if (isUuid) {
        // Try matching table by id
        const { data: byTableId } = await supabase
            .from('tables')
            .select('id, restaurant_id, room_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
            .eq('id', qrToken)
            .maybeSingle()

        if (byTableId) {
            return {
                id: byTableId.id,
                restaurant_id: byTableId.restaurant_id,
                room_id: byTableId.room_id,
                label: byTableId.label,
                restaurants: Array.isArray(byTableId.restaurants) ? byTableId.restaurants[0] || null : (byTableId.restaurants as unknown as TableByToken['restaurants']),
            }
        }

        // Try matching table by room_id
        const { data: byRoomId } = await supabase
            .from('tables')
            .select('id, restaurant_id, room_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
            .eq('room_id', qrToken)
            .maybeSingle()

        if (byRoomId) {
            return {
                id: byRoomId.id,
                restaurant_id: byRoomId.restaurant_id,
                room_id: byRoomId.room_id,
                label: byRoomId.label,
                restaurants: Array.isArray(byRoomId.restaurants) ? byRoomId.restaurants[0] || null : (byRoomId.restaurants as unknown as TableByToken['restaurants']),
            }
        }

        // If it's a room ID without a linked table row yet, auto-provision it
        const { data: room } = await supabase
            .from('rooms')
            .select('id, restaurant_id, room_number')
            .eq('id', qrToken)
            .maybeSingle()

        if (room) {
            try {
                const { randomBytes } = await import('crypto')
                const newQrToken = randomBytes(18).toString('base64url')
                const { data: newTable } = await supabase
                    .from('tables')
                    .insert({
                        restaurant_id: room.restaurant_id,
                        room_id: room.id,
                        label: `Room ${room.room_number}`,
                        qr_token: newQrToken,
                        is_active: true
                    })
                    .select('id, restaurant_id, room_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
                    .maybeSingle()

                if (newTable) {
                    return {
                        id: newTable.id,
                        restaurant_id: newTable.restaurant_id,
                        room_id: newTable.room_id,
                        label: newTable.label,
                        restaurants: Array.isArray(newTable.restaurants) ? newTable.restaurants[0] || null : (newTable.restaurants as unknown as TableByToken['restaurants']),
                    }
                }
            } catch (err) {
                console.error('Failed to auto-provision table for room', room.id, err)
            }
        }
    }

    return null
})
