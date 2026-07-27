'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'
import { getCachedMenuData } from '@/lib/menu-cache'
import { getRoomContextForTable } from '@/lib/rooms'
import { getCurrentUser } from '@/lib/auth'

export async function openSession(tableId: string, restaurantId: string, guestCount?: number, seatNumber: number = 1) {
    const adminSupabase = await createAdminClient()

    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) {
        console.error('[openSession] No authenticated user found')
        return { error: 'Unauthorized' }
    }
    const user = { id: currentUser.id }

    // Expire any stale sessions for this table+seat that passed their expires_at
    // but were never cleaned up — otherwise the unique-active-per-table-per-seat
    // index blocks the insert.
    await adminSupabase
        .from('sessions')
        .update({ status: 'expired', closed_at: new Date().toISOString() })
        .eq('table_id', tableId)
        .eq('seat_number', seatNumber)
        .eq('status', 'active')
        .lt('expires_at', new Date().toISOString())

    // Generate a URL-safe session token (avoids DB-level base64url encoding issues)
    const { randomBytes } = await import('crypto')
    const sessionToken = randomBytes(32).toString('base64url')

    const { data, error } = await adminSupabase
        .from('sessions')
        .insert({
            table_id: tableId,
            restaurant_id: restaurantId,
            opened_by: user.id,
            guest_count: guestCount || null,
            session_token: sessionToken,
            seat_number: seatNumber,
        })
        .select('*')
        .single()

    if (error) {
        console.error('[openSession] Insert failed:', error)
        if (error.code === '23505') return { error: seatNumber > 1 ? `Seat ${seatNumber} already has an active session` : 'Table already has an active session' }
        return { error: error.message }
    }

    void logAudit({
        restaurantId,
        userId: user.id,
        action: 'session_opened',
        entityType: 'session',
        entityId: data?.id,
        newValue: { table_id: tableId, guest_count: guestCount ?? null, seat_number: seatNumber },
    })

    revalidatePath('/waiter')
    return { success: true, session: data }
}

/**
 * Cancel a transient session that had no orders placed.
 * Unlike closeSession, this does NOT mark the table dirty — it resets it
 * straight to 'available' since there is nothing to clean up.
 */
export async function cancelTransientSession(sessionId: string): Promise<{ error?: string; success?: boolean }> {
    const adminSupabase = await createAdminClient()

    // Close the session row
    const { error } = await adminSupabase
        .from('sessions')
        .update({ status: 'closed', closed_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('status', 'active')

    if (error) return { error: error.message }

    // Look up the table so we can reset its status to available
    const { data: session } = await adminSupabase
        .from('sessions')
        .select('table_id')
        .eq('id', sessionId)
        .maybeSingle()

    if (session?.table_id) {
        await adminSupabase
            .from('tables')
            .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
            .eq('id', session.table_id)
    }

    revalidatePath('/waiter')
    return { success: true }
}

export async function closeSession(sessionId: string) {
    const adminSupabase = await createAdminClient()
    const currentUser = await getCurrentUser().catch(() => null)

    const { data: session, error } = await adminSupabase
        .from('sessions')
        .update({
            status: 'closed',
            closed_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('status', 'active')
        .select('restaurant_id')
        .single()

    if (error) return { error: error.message }

    // Closing the session leaves the table needing clean-up.
    await markTableDirtyForSession(adminSupabase, sessionId)

    void logAudit({
        restaurantId: session.restaurant_id,
        userId: currentUser?.id ?? null,
        action: 'session_closed',
        entityType: 'session',
        entityId: sessionId,
        newValue: { reason: 'manual' },
    })

    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Opens a session for a table AND completes the open_session service request in one action.
 */
export async function openSessionFromRequest(
    requestId: string,
    tableId: string,
    restaurantId: string
): Promise<{ error?: string; success?: boolean; session?: any }> {
    const result = await openSession(tableId, restaurantId)
    if (result.error) return { error: result.error }

    const adminSupabase = await createAdminClient()
    await adminSupabase
        .from('service_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', requestId)

    return { success: true, session: result.session }
}

/**
 * Waiter marks a table as dirty (needs cleaning) or reserved.
 * Clears back to 'available' once actioned.
 */
export async function setTableStatus(
    tableId: string,
    status: 'available' | 'dirty' | 'reserved'
): Promise<{ error?: string; success?: boolean }> {
    const supabase = await createAdminClient()
    // Any manual status change resets the cleaning claim — a freshly-dirty table
    // is unclaimed, and clearing/reserving drops a stale owner.
    const { error } = await supabase
        .from('tables')
        .update({ table_status: status, cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)

    if (error) return { error: error.message }
    revalidatePath('/waiter')
    return { success: true }
}

/**
 * Cleaning ownership — the same single-owner model as order/cooking claims.
 *  • claimTableCleaning ("I am going"): take a dirty, unclaimed table.
 *  • markTableClean: clear it back to available — only the claiming waiter (or an
 *    unclaimed table) may do this.
 *  • releaseTableCleaning: drop your own claim so someone else can take it.
 */
export async function claimTableCleaning(
    tableId: string
): Promise<{ error?: string; success?: boolean; conflict?: boolean }> {
    const admin = await createAdminClient()
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) return { error: 'Unauthorized' }
    const user = { id: currentUser.id }

    const { data, error } = await admin
        .from('tables')
        .update({ cleaning_claimed_by: user.id, cleaning_claimed_at: new Date().toISOString() })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        .is('cleaning_claimed_by', null)
        .select('id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Another waiter already took this table' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function releaseTableCleaning(
    tableId: string
): Promise<{ error?: string; success?: boolean }> {
    const admin = await createAdminClient()
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) return { error: 'Unauthorized' }
    const user = { id: currentUser.id }

    await admin
        .from('tables')
        .update({ cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('cleaning_claimed_by', user.id)

    revalidatePath('/waiter')
    return { success: true }
}

export async function markTableClean(
    tableId: string
): Promise<{ error?: string; success?: boolean; conflict?: boolean }> {
    const admin = await createAdminClient()
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) return { error: 'Unauthorized' }
    const user = { id: currentUser.id }

    // PostgREST throws a spurious "column does not exist" error when an .or()
    // filter is combined with .update() on this table, so the owner-or-unclaimed
    // check is done as a separate read instead of folding it into the update's
    // WHERE clause.
    const { data: current, error: readError } = await admin
        .from('tables')
        .select('table_status, cleaning_claimed_by')
        .eq('id', tableId)
        .maybeSingle()

    if (readError) return { error: readError.message }
    if (!current || current.table_status !== 'dirty') {
        return { conflict: true, error: 'Table is not marked dirty' }
    }
    if (current.cleaning_claimed_by && current.cleaning_claimed_by !== user.id) {
        return { conflict: true, error: 'Only the waiter who took this table can mark it clean' }
    }

    const { data, error } = await admin
        .from('tables')
        .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        .select('id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Only the waiter who took this table can mark it clean' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function findBookingByPhone(phone: string, restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const cleanPhone = phone.trim()

    // Resolve linked hotel if any
    const { data: restLink } = await adminSupabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', restaurantId)
        .maybeSingle()

    const targetRestaurantId = restLink?.linked_hotel_id || restaurantId

    const { data: booking, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in')
        .eq('guest_phone', cleanPhone)
        .maybeSingle()

    if (error) {
        console.error('[findBookingByPhone] Error:', error)
        return { error: 'Failed to search booking' }
    }
    return { success: true, booking }
}

export async function findBookingByRoom(roomNumber: string, restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const cleanRoom = roomNumber.trim()

    // Resolve linked hotel if any
    const { data: restLink } = await adminSupabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', restaurantId)
        .maybeSingle()

    const targetRestaurantId = restLink?.linked_hotel_id || restaurantId

    const { data: booking, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms!inner(room_number)')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in')
        .eq('rooms.room_number', cleanRoom)
        .maybeSingle()

    if (error) {
        console.error('[findBookingByRoom] Error:', error)
        return { error: 'Failed to search booking' }
    }
    return { success: true, booking }
}

export async function getActiveBookings(restaurantId: string) {
    const adminSupabase = await createAdminClient()

    // Resolve linked hotel if any
    const { data: restLink } = await adminSupabase
        .from('restaurants')
        .select('linked_hotel_id')
        .eq('id', restaurantId)
        .maybeSingle()

    const targetRestaurantId = restLink?.linked_hotel_id || restaurantId

    const { data: bookings, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', targetRestaurantId)
        .eq('status', 'checked_in')
        .order('check_in', { ascending: false })

    if (error) {
        console.error('[getActiveBookings] Error:', error)
        return { error: 'Failed to fetch active bookings' }
    }
    return { success: true, bookings }
}

export async function linkSessionToBooking(sessionId: string, bookingId: string, tableId?: string) {
    const adminSupabase = await createAdminClient()
    const now = new Date().toISOString()

    // 1. Update session: set booking_id AND close session so table is freed
    const { data: session, error } = await adminSupabase
        .from('sessions')
        .update({
            booking_id: bookingId,
            status: 'closed',
            closed_at: now,
        })
        .eq('id', sessionId)
        .select('table_id')
        .maybeSingle()

    if (error) {
        console.error('[linkSessionToBooking] Error:', error)
        return { error: error.message }
    }

    // 2. Also update existing orders for this session so queries on orders.booking_id catch them
    await adminSupabase
        .from('orders')
        .update({ booking_id: bookingId })
        .eq('session_id', sessionId)

    // 3. Free the table (set table_status = 'available')
    const targetTableId = tableId || session?.table_id
    if (targetTableId) {
        await adminSupabase
            .from('tables')
            .update({ table_status: 'available' })
            .eq('id', targetTableId)
    }

    revalidatePath('/waiter')
    revalidatePath('/cashier')
    revalidatePath('/kitchen')
    revalidatePath('/admin')
    return { success: true }
}

export async function moveSessionToTable(sessionId: string, targetTableId: string, currentTableId: string) {
    const adminSupabase = await createAdminClient()

    const { error: sessionError } = await adminSupabase
        .from('sessions')
        .update({ table_id: targetTableId })
        .eq('id', sessionId)

    if (sessionError) {
        console.error('[moveSessionToTable] Error:', sessionError)
        return { error: sessionError.message }
    }

    if (currentTableId && currentTableId !== targetTableId) {
        // Free the old table
        await adminSupabase
            .from('tables')
            .update({ table_status: 'available' })
            .eq('id', currentTableId)

        // Mark the new table as occupied
        await adminSupabase
            .from('tables')
            .update({ table_status: 'occupied' })
            .eq('id', targetTableId)
    }

    revalidatePath('/waiter')
    revalidatePath('/cashier')
    revalidatePath('/kitchen')
    return { success: true }
}

export async function getStaffMenu(restaurantId: string) {
    // Check if staff user (works for all roles including super_admin)
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) return { error: 'Unauthorized' }

    try {
        const data = await getCachedMenuData(restaurantId)
        return {
            success: true,
            categories: data.categories || [],
            menuItems: data.menuItems || []
        }
    } catch (e: any) {
        console.error('[getStaffMenu] Error:', e)
        return { error: 'Failed to load menu' }
    }
}

export async function placeStaffOrder(
    sessionId: string,
    items: any[],
    customerNote?: string
) {
    const adminSupabase = await createAdminClient()

    // Check if staff user (works for all roles including super_admin)
    const currentUser = await getCurrentUser().catch(() => null)
    if (!currentUser?.id) return { error: 'Unauthorized' }

    // Resolve session (UUID vs token) safely to avoid UUID casting errors in Postgres
    let query = adminSupabase
        .from('sessions')
        .select('id, restaurant_id, status, table_id, booking_id')
        .eq('status', 'active')

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)
    if (isUuid) {
        query = query.eq('id', sessionId)
    } else {
        query = query.eq('session_token', sessionId)
    }

    const { data: session, error: sessionError } = await query.maybeSingle()

    if (sessionError || !session) {
        console.error('[placeStaffOrder] Session lookup failed:', sessionError, sessionId)
        return { error: 'Table session is invalid or closed.' }
    }

    // Format items for RPC
    const payload = items.map((i) => {
        let specialRequest = i.specialRequest || ''
        if (i.variationName) {
            specialRequest = specialRequest
                ? `[${i.variationName}] ${specialRequest}`
                : `[${i.variationName}]`
        }
        return {
            menu_item_id: i.menuItemId,
            quantity: i.quantity,
            special_request: specialRequest || null,
            modifiers: (i.modifiers || []).map((m: any) => ({
                modifier_id: m.modifierId || m.id,
            })),
            variation_id: i.variationId || null,
        }
    })

    try {
        // Place the order
        const { data, error } = await adminSupabase.rpc('place_order', {
            p_session_id: session.id,
            p_items: payload,
            p_customer_note: customerNote || null,
            p_promo_code: null,
            p_loyalty_member_id: null,
            p_client_request_id: null,
        })

        if (error) {
            console.error('[placeStaffOrder] RPC Error:', error)
            return { error: error.message }
        }

        const result = data as { order_id: string }
        if (!result || !result.order_id) {
            return { error: 'Failed to place order.' }
        }

        // If this session is for a hotel room, bind the order to the active booking
        const roomContext = session.table_id
            ? await getRoomContextForTable(adminSupabase, session.table_id)
            : null

        const updateFields: any = {
            status: 'confirmed',
            needs_confirmation: false
        }
        if (roomContext?.bookingId) {
            updateFields.booking_id = roomContext.bookingId
        }

        await adminSupabase
            .from('orders')
            .update(updateFields)
            .eq('id', result.order_id)

        // Automatically close the table session if linked to a room bill (either on session or table-linked)
        const bookingIdToLink = session.booking_id || roomContext?.bookingId
        if (bookingIdToLink) {
            await adminSupabase
                .from('sessions')
                .update({
                    status: 'closed',
                    closed_at: new Date().toISOString()
                })
                .eq('id', session.id)

            await markTableDirtyForSession(adminSupabase, session.id)

            void logAudit({
                restaurantId: session.restaurant_id,
                userId: currentUser.id,
                action: 'session_closed',
                entityType: 'session',
                entityId: session.id,
                newValue: { reason: 'auto_room_linked_order' },
            })
        }

        // place_order() already deducted stock/ingredients inline for every item —
        // do not call deduct_ingredients_for_order here, it would double-deduct.

        revalidatePath('/waiter')
        revalidatePath('/cashier')

        return { success: true, orderId: result.order_id }
    } catch (e: any) {
        console.error('[placeStaffOrder] Exception:', e)
        return { error: e.message || 'Server error' }
    }
}

export async function placeRoomOrderDirect(
    bookingId: string,
    items: any[],
    customerNote?: string
) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()
    
    // 1. Fetch booking to make sure it's active
    const { data: booking, error: bookingErr } = await adminSupabase
        .from('bookings')
        .select('id, status, restaurant_id')
        .eq('id', bookingId)
        .single()

    if (bookingErr || !booking || booking.status !== 'checked_in') {
        return { error: 'Room stay booking is invalid or checked out.' }
    }

    // Check if staff user
    const currentUser = await getCurrentUser().catch(() => null)
    const restaurantId = currentUser?.restaurantId || booking.restaurant_id
    if (!restaurantId) return { error: 'Unauthorized' }

    // 2. Create pending order row with needs_confirmation: true and status: 'pending'
    // so Realtime does not broadcast an unconfirmed/empty order to kitchen/cashier.
    const { data: orderRow, error: orderInsertError } = await adminSupabase
        .from('orders')
        .insert({
            restaurant_id: restaurantId,
            booking_id: bookingId,
            customer_note: customerNote || null,
            status: 'pending',
            needs_confirmation: true,
            payment_status: 'unpaid',
            order_type: 'takeout',
            placed_at: new Date().toISOString(),
            subtotal_amount: 0,
            total_amount: 0
        })
        .select('id')
        .single()

    if (orderInsertError || !orderRow?.id) {
        console.error('[placeRoomOrderDirect] Order insert failed:', orderInsertError)
        return { error: orderInsertError?.message || 'Failed to create order.' }
    }

    const orderId = orderRow.id
    let subtotal = 0

    // 3. Insert order items with needs_confirmation: true
    for (const item of items) {
        const { data: menuItem } = await adminSupabase
            .from('menu_items')
            .select('id, price, is_available')
            .eq('id', item.menuItemId)
            .single()

        if (!menuItem?.id || menuItem.is_available === false) continue

        let unitPrice = Number(menuItem.price ?? 0)
        let variationId = null
        if (item.variationId) {
            const { data: variation } = await adminSupabase
                .from('menu_item_variations')
                .select('id, price')
                .eq('id', item.variationId)
                .single()
            if (variation) {
                unitPrice = Number(variation.price)
                variationId = variation.id
            }
        }

        const specialRequest = item.specialRequest || null

        const { data: orderItemRow, error: orderItemInsertError } = await adminSupabase
            .from('order_items')
            .insert({
                order_id: orderId,
                menu_item_id: menuItem.id,
                menu_item_variation_id: variationId,
                quantity: item.quantity,
                unit_price: unitPrice,
                special_request: specialRequest,
                status: 'pending',
                needs_confirmation: true
            })
            .select('id')
            .single()

        if (orderItemInsertError || !orderItemRow?.id) {
            console.error('[placeRoomOrderDirect] Item insert failed:', orderItemInsertError)
            continue
        }

        let itemTotal = unitPrice * item.quantity

        // Handle modifiers if any
        if (item.modifiers?.length) {
            for (const mod of item.modifiers) {
                const { data: modRow } = await adminSupabase
                    .from('menu_item_modifiers')
                    .select('id, name, price_adjustment')
                    .eq('id', mod.modifierId || mod.id)
                    .single()

                if (!modRow?.id) continue

                await adminSupabase.from('order_item_modifiers').insert({
                    order_item_id: orderItemRow.id,
                    modifier_id: modRow.id,
                    modifier_name: modRow.name,
                    price_adjustment: modRow.price_adjustment,
                })

                itemTotal += Number(modRow.price_adjustment ?? 0) * item.quantity
            }
        }

        subtotal += itemTotal
    }

    // 4. Calculate Taxes and Service Charge
    const { data: settings } = await adminSupabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single()
    
    const featuresV2 = settings?.features_v2 as any
    const taxRate = Number(featuresV2?.defaultTaxRate ?? 0)
    const scEnabled = featuresV2?.serviceChargeEnabled === true
    const scRate = Number(featuresV2?.serviceChargeRate ?? 10)

    const serviceCharge = scEnabled 
        ? Math.round(subtotal * (scRate / 100) * 100) / 100 
        : 0

    const tax = Math.round((subtotal + serviceCharge) * (taxRate / 100) * 100) / 100
    const total = Math.max(0, subtotal + serviceCharge + tax)

    // 5. Unmark needs_confirmation on order_items now that all items and modifiers are written
    await adminSupabase
        .from('order_items')
        .update({ needs_confirmation: false })
        .eq('order_id', orderId)

    // 6. Update order status to 'confirmed' and needs_confirmation: false along with totals
    try {
        const { error: updateError } = await adminSupabase
            .from('orders')
            .update({
                status: 'confirmed',
                needs_confirmation: false,
                subtotal_amount: subtotal,
                service_charge_amount: serviceCharge,
                tax_amount: tax,
                total_amount: total
            })
            .eq('id', orderId)
        
        if (updateError) {
            if (updateError.message.includes('service_charge_amount') || updateError.code === 'PGRST204') {
                await adminSupabase
                    .from('orders')
                    .update({
                        status: 'confirmed',
                        needs_confirmation: false,
                        subtotal_amount: subtotal,
                        tax_amount: tax,
                        total_amount: total
                    })
                    .eq('id', orderId)
            } else {
                console.error('[placeRoomOrderDirect] Update totals error:', updateError)
            }
        }
    } catch (err) {
        console.error('[placeRoomOrderDirect] Catch block update totals:', err)
        await adminSupabase
            .from('orders')
            .update({
                status: 'confirmed',
                needs_confirmation: false,
                subtotal_amount: subtotal,
                tax_amount: tax,
                total_amount: total
            })
            .eq('id', orderId)
    }

    // Apply pricing rules & deduct ingredients
    await Promise.allSettled([
        adminSupabase.rpc('apply_pricing_rules_to_order', { p_order_id: orderId }),
        adminSupabase.rpc('deduct_ingredients_for_order',  { p_order_id: orderId }),
    ])

    revalidatePath('/cashier')
    return { success: true, orderId }
}

