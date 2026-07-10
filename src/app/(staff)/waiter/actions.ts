'use server'

import { createServerClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAudit } from '@/lib/audit'
import { markTableDirtyForSession } from '@/lib/tableLifecycle'
import { getCachedMenuData } from '@/lib/menu-cache'
import { getRoomContextForTable } from '@/lib/rooms'
import { getCurrentUser } from '@/lib/auth'

export async function openSession(tableId: string, restaurantId: string, guestCount?: number) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        console.error('[openSession] No authenticated user found')
        return { error: 'Unauthorized' }
    }

    // Expire any stale sessions for this table that passed their expires_at but
    // were never cleaned up — otherwise the unique-active-per-table index blocks the insert.
    await adminSupabase
        .from('sessions')
        .update({ status: 'expired', closed_at: new Date().toISOString() })
        .eq('table_id', tableId)
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
        })
        .select('*')
        .single()

    if (error) {
        console.error('[openSession] Insert failed:', error)
        if (error.code === '23505') return { error: 'Table already has an active session' }
        return { error: error.message }
    }

    void logAudit({
        restaurantId,
        userId: user.id,
        action: 'session_opened',
        entityType: 'session',
        entityId: data?.id,
        newValue: { table_id: tableId, guest_count: guestCount ?? null },
    })

    revalidatePath('/waiter')
    return { success: true, session: data }
}

export async function closeSession(sessionId: string) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()

    const { data: { user } } = await supabase.auth.getUser()

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
        userId: user?.id ?? null,
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
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

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
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

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
    const supabase = await createServerClient()
    const admin = await createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const { data, error } = await admin
        .from('tables')
        .update({ table_status: 'available', cleaning_claimed_by: null, cleaning_claimed_at: null })
        .eq('id', tableId)
        .eq('table_status', 'dirty')
        // Owner-only, or anyone if it was never claimed.
        .or(`cleaning_claimed_by.eq.${user.id},cleaning_claimed_by.is.null`)
        .select('id')

    if (error) return { error: error.message }
    if (!data || data.length === 0) return { conflict: true, error: 'Only the waiter who took this table can mark it clean' }
    revalidatePath('/waiter')
    return { success: true }
}

export async function findBookingByPhone(phone: string, restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const cleanPhone = phone.trim()
    const { data: booking, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'checked_in')
        .eq('guest_phone', cleanPhone)
        .maybeSingle()

    if (error) {
        console.error('[findBookingByPhone] Error:', error)
        return { error: 'Failed to search booking' }
    }
    return { success: true, booking }
}

export async function getActiveBookings(restaurantId: string) {
    const adminSupabase = await createAdminClient()
    const { data: bookings, error } = await adminSupabase
        .from('bookings')
        .select('id, guest_name, guest_phone, status, room_id, rooms(room_number)')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'checked_in')
        .order('check_in', { ascending: false })

    if (error) {
        console.error('[getActiveBookings] Error:', error)
        return { error: 'Failed to fetch active bookings' }
    }
    return { success: true, bookings }
}

export async function linkSessionToBooking(sessionId: string, bookingId: string) {
    const adminSupabase = await createAdminClient()
    const { error } = await adminSupabase
        .from('sessions')
        .update({ booking_id: bookingId })
        .eq('id', sessionId)

    if (error) {
        console.error('[linkSessionToBooking] Error:', error)
        return { error: error.message }
    }
    revalidatePath('/waiter')
    return { success: true }
}

export async function getStaffMenu(restaurantId: string) {
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()
    
    // Check if staff user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

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
    const supabase = await createServerClient()
    const adminSupabase = await createAdminClient()
    
    // Check if staff user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    // Resolve session (UUID vs token) safely to avoid UUID casting errors in Postgres
    let query = adminSupabase
        .from('sessions')
        .select('id, restaurant_id, status, table_id')
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

        if (roomContext?.bookingId) {
            await adminSupabase
                .from('orders')
                .update({ 
                    booking_id: roomContext.bookingId, 
                    status: 'confirmed', 
                    needs_confirmation: false 
                })
                .eq('id', result.order_id)
        } else {
            await adminSupabase
                .from('orders')
                .update({ status: 'confirmed', needs_confirmation: false })
                .eq('id', result.order_id)
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
    
    // Check if staff user
    const { restaurantId } = await getCurrentUser()
    if (!restaurantId) return { error: 'Unauthorized' }

    // 1. Fetch booking to make sure it's active
    const { data: booking, error: bookingErr } = await adminSupabase
        .from('bookings')
        .select('id, status')
        .eq('id', bookingId)
        .single()

    if (bookingErr || !booking || booking.status !== 'checked_in') {
        return { error: 'Room stay booking is invalid or checked out.' }
    }

    // 2. Create pending order row
    const { data: orderRow, error: orderInsertError } = await adminSupabase
        .from('orders')
        .insert({
            restaurant_id: restaurantId,
            booking_id: bookingId,
            customer_note: customerNote || null,
            status: 'confirmed',
            needs_confirmation: false,
            payment_status: 'unpaid',
            order_type: 'dine_in'
        })
        .select('id')
        .single()

    if (orderInsertError || !orderRow?.id) {
        console.error('[placeRoomOrderDirect] Order insert failed:', orderInsertError)
        return { error: 'Failed to create order.' }
    }

    const orderId = orderRow.id
    let subtotal = 0

    // 3. Insert order items
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
                status: 'pending'
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

    // Update totals on order
    await adminSupabase
        .from('orders')
        .update({
            subtotal_amount: subtotal,
            service_charge_amount: serviceCharge,
            tax_amount: tax,
            total_amount: total
        })
        .eq('id', orderId)

    // Apply pricing rules & deduct ingredients
    await Promise.allSettled([
        adminSupabase.rpc('apply_pricing_rules_to_order', { p_order_id: orderId }),
        adminSupabase.rpc('deduct_ingredients_for_order',  { p_order_id: orderId }),
    ])

    revalidatePath('/cashier')
    return { success: true, orderId }
}

