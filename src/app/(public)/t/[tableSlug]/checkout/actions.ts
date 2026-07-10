'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { CartItem } from '@/types/database'
import { headers } from 'next/headers'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { validateInput, OrderItemSchema } from '@/lib/validation'
import { z } from 'zod'
import { sendOrderConfirmationSms, sendLoyaltyPointsSms } from '@/lib/sms'
import { checkAndAlertLowStock } from '@/app/(admin)/admin/ingredients/actions'
import { getRestaurantFeatures } from '@/lib/features'
import { verifyClientIp } from '@/lib/ip-check'
import { getRoomContextForTable } from '@/lib/rooms'

type PlaceOrderItemPayload = {
    menu_item_id: string
    quantity: number
    special_request: string | null
    modifiers: { modifier_id: string }[]
    variation_id?: string | null
}

// Serverless-safe rate limiting via Upstash Redis
// Each IP gets 5 requests per 60-second sliding window
// Lazily initialized so missing env vars don't crash the entire module
let _ratelimit: Ratelimit | null = null
function getRatelimit(): Ratelimit | null {
    if (_ratelimit) return _ratelimit
    try {
        _ratelimit = new Ratelimit({
            redis: Redis.fromEnv(),
            limiter: Ratelimit.slidingWindow(5, '60 s'),
            analytics: true,
            prefix: 'srms:order-ratelimit',
        })
        return _ratelimit
    } catch {
        console.warn('Upstash Redis not configured — rate limiting disabled')
        return null
    }
}

export async function placeOrder(
    sessionId: string,
    restaurantSlug: string,
    items: CartItem[],
    customerNote?: string,
    promoCode?: string | null,
    loyaltyMemberId?: string | null,
    clientRequestId?: string | null,
    loyaltyDiscount?: number | null
): Promise<{
    orderId?: string
    subtotal?: number
    discount?: number
    tax?: number
    total?: number
    pointsEarned?: number
    error?: string
}> {
    const PlaceOrderInputSchema = z.object({
        sessionId: z.string().min(1, 'Session ID required'),
        restaurantSlug: z.string().min(1).max(100),
        items: z.array(OrderItemSchema).min(1, 'At least one item required'),
        customerNote: z.string().max(500).nullable().optional(),
        promoCode: z.string().max(50).nullable().optional(),
        loyaltyMemberId: z.string().uuid().nullable().optional(),
        clientRequestId: z.string().min(1).max(100).nullable().optional(),
        loyaltyDiscount: z.number().nonnegative().nullable().optional()
    })

    // Format items payload for the place_order RPC (includes modifiers)
    const payload: PlaceOrderItemPayload[] = items.map((i) => {
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
            modifiers: (i.modifiers || []).map((m) => ({
                modifier_id: m.modifierId,
            })),
            variation_id: i.variationId || null,
        }
    })

    const validation = validateInput(PlaceOrderInputSchema, {
        sessionId,
        restaurantSlug,
        items: payload,
        customerNote,
        promoCode,
        loyaltyMemberId,
        clientRequestId,
        loyaltyDiscount
    })

    if (!validation.success) {
        console.warn('Place order validation failed:', validation.error)
        return { error: `Invalid request: ${validation.error}` }
    }

    // 1. Anti-Spam Rate Limiting via Upstash Redis (serverless-safe)
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for') || 'fallback-ip'

    const ratelimit = getRatelimit()
    if (ratelimit) {
        try {
            const { success, remaining } = await ratelimit.limit(ip)
            if (!success) {
                console.warn(`Rate limit exceeded for IP: ${ip} (remaining: ${remaining})`)
                return { error: 'You are placing orders too quickly. Please wait a minute and try again.' }
            }
        } catch (err) {
            console.error('Rate limiting failed (Upstash Redis unreachable):', err)
            // Allow the request through gracefully if Redis is down
        }
    }

    // 2. Proceed with Order Placement
    const supabase = await createAdminClient()

    // 2a. Resolve session_token → session UUID
    // The client passes session_token (e.g. 's-abc123'), but the RPC expects the UUID primary key
    const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('id, restaurant_id, table_id')
        .eq('session_token', sessionId)
        .eq('status', 'active')
        .single()

    if (sessionError || !sessionData) {
        return { error: 'Your table session has expired or is invalid. Please ask your waiter to reopen.' }
    }

    // 2b. Enforce WiFi IP restriction
    const { allowed: ipAllowed } = await verifyClientIp(sessionData.restaurant_id, 'customer')
    if (!ipAllowed) {
        return { error: 'Your current network IP is not allowed to place orders for this restaurant.' }
    }

    // 2c. In-room orders must belong to a stay. The QR page already blocks an
    // un-checked-in room, but this is the authoritative gate — a stale tab or a
    // direct call must not create an order that can never be billed to a folio.
    // `roomContext` is null for ordinary dining tables, which skip all of this.
    const roomContext = sessionData.table_id
        ? await getRoomContextForTable(supabase, sessionData.table_id)
        : null

    if (roomContext && !roomContext.bookingId) {
        return { error: `Room ${roomContext.roomNumber} is not checked in. Please contact reception.` }
    }

    const sessionUuid = sessionData.id
    const isHotelRoom = !!roomContext

    const features = await getRestaurantFeatures(sessionData.restaurant_id)
    const waiterSessionEnabled = (features as { waiterSessionEnabled?: boolean } | null)?.waiterSessionEnabled === true

    // 2b. Prevent multiple active orders per session (anti-spam / kitchen overload)
    // Only apply this anti-spam check if waiter sessions are disabled (self-service mode) and it is NOT a hotel room stay
    if (!waiterSessionEnabled && !isHotelRoom) {
        const { count: activeUndelivered } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', sessionUuid)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
            .neq('client_request_id', clientRequestId || 'none')

        if (activeUndelivered && activeUndelivered > 0) {
            return { error: 'You have an active order being prepared. Please wait for it to be delivered before ordering more.' }
        }
    }

    // Call the ACID-safe RPC (returns JSONB with breakdown)
    const { data, error } = await supabase.rpc('place_order', {
        p_session_id: sessionUuid,
        p_items: payload,
        p_customer_note: customerNote || null,
        p_promo_code: promoCode || null,
        p_loyalty_member_id: loyaltyMemberId || null,
        p_client_request_id: clientRequestId || null,
    })

    if (error) {
        console.error('RPC Error:', error)

        // Map Postgres exception codes to user-friendly messages
        if (error.message.includes('OUT_OF_STOCK') || error.message.includes('ITEM_UNAVAILABLE')) {
            return { error: 'Sorry, one or more items just sold out or are unavailable!' }
        }
        if (error.message.includes('INVALID_SESSION')) {
            return { error: 'Your table session has expired. Ask your waiter to reopen.' }
        }
        if (error.message.includes('INVALID_PROMO')) {
            return { error: 'The promo code is invalid or has expired.' }
        }

        // Hosted DB hotfix fallback:
        // If the RPC itself is broken on this environment (e.g. missing columns,
        // unassigned record), create order rows directly so core flow still works.
        const fallback = await placeOrderFallback(
            supabase,
            sessionUuid,
            payload,
            customerNote || null,
            loyaltyMemberId || null,
            promoCode || null,
            clientRequestId || null,
            loyaltyDiscount
        )

        if (fallback) {
            // The fallback path bills to the same stay as the RPC path.
            if (roomContext?.bookingId) {
                await supabase
                    .from('orders')
                    .update({ booking_id: roomContext.bookingId })
                    .eq('id', fallback.orderId)
            }
            revalidatePath(`/t/${restaurantSlug}`)
            return fallback
        }

        return { error: 'Order failed to place. Please try again or ask a waiter.' }
    }

    // Apply dynamic pricing rules then deduct ingredient stock (best-effort — don't fail the order)
    const result = data as {
        order_id: string
        subtotal: number
        discount: number
        tax: number
        total: number
        points_earned: number
    }

    if (result.order_id) {
        // Bind an in-room order to the stay it belongs to. Doing this here rather
        // than deriving it later means the folio survives the session closing or
        // expiring — the booking owns its orders for good.
        if (roomContext?.bookingId) {
            const { error: bindError } = await supabase
                .from('orders')
                .update({ booking_id: roomContext.bookingId })
                .eq('id', result.order_id)
            if (bindError) {
                console.error('[order]', result.order_id, 'failed to bind booking:', bindError)
            }
        }

        // If there are variations, look up their prices and update order_items
        const variationIds = items.map(i => i.variationId).filter(Boolean) as string[]
        let variations: { id: string; price: number }[] = []
        if (variationIds.length > 0) {
            const { data: varData } = await supabase
                .from('menu_item_variations')
                .select('id, price')
                .in('id', variationIds)
            variations = varData || []
        }

        const { data: dbOrderItems } = await supabase
            .from('order_items')
            .select('id, menu_item_id, quantity, special_request')
            .eq('order_id', result.order_id)

        let calculatedSubtotal = 0
        if (dbOrderItems && dbOrderItems.length > 0) {
            const matchedDbItemIds = new Set<string>()

            for (const item of items) {
                let basePrice = item.price
                if (item.variationId) {
                    const v = variations.find(x => x.id === item.variationId)
                    if (v) basePrice = Number(v.price)
                }
                const modifierTotal = (item.modifiers || []).reduce((sum, mod) => sum + mod.priceAdjustment, 0)
                calculatedSubtotal += (basePrice + modifierTotal) * item.quantity

                // Build the special request we sent to the DB
                let expectedSpecialRequest = item.specialRequest || ''
                if (item.variationName) {
                    expectedSpecialRequest = expectedSpecialRequest
                        ? `[${item.variationName}] ${expectedSpecialRequest}`
                        : `[${item.variationName}]`
                }
                
                // Find matching row in the database, excluding already matched ones
                const match = dbOrderItems.find(
                    x => !matchedDbItemIds.has(x.id) &&
                         x.menu_item_id === item.menuItemId &&
                         x.quantity === item.quantity &&
                         (x.special_request || '') === expectedSpecialRequest
                )

                if (match) {
                    matchedDbItemIds.add(match.id)
                    if (item.variationId) {
                        // Update the unit price to the correct variation price
                        await supabase
                            .from('order_items')
                            .update({ unit_price: basePrice })
                            .eq('id', match.id)
                    }
                }
            }
            
            // If there's a loyalty discount, save it to the order table first so it gets calculated
            if (loyaltyDiscount && loyaltyDiscount > 0) {
                const existingPromoDiscount = Number(result.discount || 0)
                const totalDiscount = existingPromoDiscount + loyaltyDiscount
                await supabase
                    .from('orders')
                    .update({
                        discount_amount: totalDiscount,
                        loyalty_member_id: loyaltyMemberId,
                    })
                    .eq('id', result.order_id)
                
                result.discount = totalDiscount
            }

            const { data: settings } = await supabase
                .from('settings')
                .select('features_v2')
                .eq('restaurant_id', sessionData.restaurant_id)
                .single()
            
            const featuresV2 = settings?.features_v2 as any
            const taxRate = Number(featuresV2?.defaultTaxRate ?? 0)
            const scEnabled = featuresV2?.serviceChargeEnabled === true
            const scRate = Number(featuresV2?.serviceChargeRate ?? 10)

            const { data: orderData } = await supabase
                .from('orders')
                .select('discount_amount')
                .eq('id', result.order_id)
                .single()

            const discountAmount = Number(orderData?.discount_amount ?? 0)
            
            const finalServiceCharge = scEnabled 
                ? Math.round((calculatedSubtotal - discountAmount) * (scRate / 100) * 100) / 100 
                : 0

            const finalTax = Math.round((calculatedSubtotal - discountAmount + finalServiceCharge) * (taxRate / 100) * 100) / 100
            const finalOrderTotal = Math.max(0, calculatedSubtotal - discountAmount + finalServiceCharge + finalTax)

            // Update the order totals in the database
            await supabase
                .from('orders')
                .update({
                    subtotal_amount: calculatedSubtotal,
                    service_charge_amount: finalServiceCharge,
                    tax_amount: finalTax,
                    total_amount: finalOrderTotal
                })
                .eq('id', result.order_id)

            // Update local variables returned in action response
            result.subtotal = calculatedSubtotal
            result.tax = finalTax
            result.total = finalOrderTotal
        }

        // Pricing is always normalised. Stock deduction + kitchen visibility depend
        // on the restaurant's order mode:
        //   • Mode 1 (direct): deduct stock now; the kitchen sees the order immediately.
        //   • Mode 2 (waiter confirmation): flag the order as needs_confirmation so the
        //     kitchen hides it, and defer stock deduction until a waiter confirms.
        const requireConfirmation = false

        const pricingResult = await supabase.rpc('apply_pricing_rules_to_order', { p_order_id: result.order_id })
        if (pricingResult.error) {
            console.error('[order]', result.order_id, 'apply_pricing_rules failed:', pricingResult.error)
        }

        if (requireConfirmation) {
            await supabase
                .from('orders')
                .update({ needs_confirmation: true })
                .eq('id', result.order_id)
        } else {
            // place_order() already deducted stock/ingredients inline for every item —
            // do not call deduct_ingredients_for_order here, it would double-deduct.
            if (sessionData.restaurant_id) {
                void checkAndAlertLowStock(sessionData.restaurant_id)
            }
        }

        // SMS notifications — best-effort, never block the order
        if (loyaltyMemberId) {
            const { data: member } = await supabase
                .from('loyalty_members')
                .select('phone, restaurant_id')
                .eq('id', loyaltyMemberId)
                .single()

            if (member?.phone) {
                const { data: restaurant } = await supabase
                    .from('restaurants')
                    .select('name')
                    .eq('id', member.restaurant_id)
                    .single()

                const restaurantName = (restaurant as { name?: string } | null)?.name ?? 'The Restaurant'

                void Promise.allSettled([
                    sendOrderConfirmationSms(member.phone, result.order_id, restaurantName),
                    result.points_earned > 0
                        ? supabase
                            .from('loyalty_members')
                            .select('points_balance')
                            .eq('id', loyaltyMemberId)
                            .single()
                            .then(({ data: lm }) =>
                                sendLoyaltyPointsSms(
                                    member.phone!,
                                    result.points_earned,
                                    (lm as { points_balance?: number } | null)?.points_balance ?? result.points_earned,
                                    restaurantName
                                )
                            )
                        : Promise.resolve(),
                ])
            }
        }

        // Fire QStash background event for non-blocking receipts & 3rd party integrations
        if (process.env.QSTASH_TOKEN) {
            import('@/lib/qstash').then(({ qstash }) => {
                const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
                qstash?.publishJSON({
                    url: `${baseUrl}/api/webhooks/qstash/order-processed`,
                    body: { orderId: result.order_id, restaurantId: sessionData.restaurant_id }
                }).catch((err: any) => console.error('[QStash] Order webhook publish error:', err))
            })
        }
    }

    // Purge the cart/menu page caches for this session
    revalidatePath(`/t/${restaurantSlug}`)

    return {
        orderId: result.order_id,
        subtotal: result.subtotal,
        discount: result.discount,
        tax: result.tax,
        total: result.total,
        pointsEarned: result.points_earned,
    }
}

async function placeOrderFallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    sessionUuid: string,
    payload: PlaceOrderItemPayload[],
    customerNote: string | null,
    loyaltyMemberId: string | null,
    promoCode: string | null = null,
    clientRequestId: string | null = null,
    loyaltyDiscount?: number | null
): Promise<{
    orderId: string
    subtotal: number
    discount: number
    tax: number
    total: number
    pointsEarned: number
} | null> {
    // Get session + restaurant context — must still be active (race condition guard)
    const { data: sessionRow, error: sessionCtxError } = await supabase
        .from('sessions')
        .select('restaurant_id')
        .eq('id', sessionUuid)
        .eq('status', 'active')
        .single()

    if (sessionCtxError || !sessionRow?.restaurant_id) return null

    const restaurantId = sessionRow.restaurant_id as string

    // Idempotency: if this exact request already produced an order, return it
    // rather than placing a duplicate on the kitchen queue.
    if (clientRequestId) {
        const { data: existing } = await supabase
            .from('orders')
            .select('id, subtotal_amount, discount_amount, tax_amount, total_amount')
            .eq('client_request_id', clientRequestId)
            .maybeSingle()

        if (existing?.id) {
            return {
                orderId: existing.id,
                subtotal: Number(existing.subtotal_amount ?? 0),
                discount: Number(existing.discount_amount ?? 0),
                tax: Number(existing.tax_amount ?? 0),
                total: Number(existing.total_amount ?? 0),
                pointsEarned: 0,
            }
        }
    }

    // Create pending order first
    const { data: orderRow, error: orderInsertError } = await supabase
        .from('orders')
        .insert({
            session_id: sessionUuid,
            restaurant_id: restaurantId,
            customer_note: customerNote,
            loyalty_member_id: loyaltyMemberId,
            status: 'pending',
            payment_status: 'unpaid',
            client_request_id: clientRequestId,
        })
        .select('id')
        .single()

    if (orderInsertError || !orderRow?.id) {
        console.error('Fallback order insert failed:', orderInsertError)
        return null
    }

    const orderId = orderRow.id as string
    let subtotal = 0

    // Insert each line item (+ optional modifiers)
    for (const item of payload) {
        const { data: menuItem } = await supabase
            .from('menu_items')
            .select('id, price, is_available')
            .eq('id', item.menu_item_id)
            .single()

        if (!menuItem?.id || menuItem.is_available === false) continue

        // Use variation price if a variation_id is provided, otherwise fall back to base price
        let unitPrice = Number(menuItem.price ?? 0)
        let variationId: string | null = null
        if (item.variation_id) {
            const { data: variation } = await supabase
                .from('menu_item_variations')
                .select('id, price')
                .eq('id', item.variation_id)
                .eq('menu_item_id', menuItem.id)
                .single()
            if (variation) {
                unitPrice = Number(variation.price)
                variationId = variation.id
            }
        }

        const { data: orderItemRow, error: orderItemInsertError } = await supabase
            .from('order_items')
            .insert({
                order_id: orderId,
                menu_item_id: menuItem.id,
                menu_item_variation_id: variationId,
                quantity: item.quantity,
                unit_price: unitPrice,
                special_request: item.special_request,
            })
            .select('id')
            .single()

        if (orderItemInsertError || !orderItemRow?.id) {
            console.error('Fallback order item insert failed:', orderItemInsertError)
            continue
        }

        let itemTotal = unitPrice * item.quantity

        if (item.modifiers?.length) {
            for (const mod of item.modifiers) {
                const { data: modRow } = await supabase
                    .from('menu_item_modifiers')
                    .select('id, name, price_adjustment')
                    .eq('id', mod.modifier_id)
                    .single()

                if (!modRow?.id) continue

                await supabase.from('order_item_modifiers').insert({
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

    let discount = 0
    let promoCodeId: string | null = null

    if (promoCode && subtotal > 0) {
        const { data: promo } = await supabase
            .from('promo_codes')
            .select('id, promo_type, value, free_item_id, bogo_buy_item_id, bogo_get_item_id, min_order_amount, max_discount_amount, max_uses, current_uses, valid_until, is_active')
            .eq('restaurant_id', restaurantId)
            .eq('code', promoCode.toUpperCase())
            .eq('is_active', true)
            .single()

        if (promo && (!promo.valid_until || new Date(promo.valid_until) > new Date())) {
            const minOrder = promo.min_order_amount ?? 0

            if (subtotal < minOrder) {
                // Minimum order not met — silently skip (RPC would raise an error; fallback skips gracefully)
                console.warn(`[fallback] Promo ${promoCode} min_order ${minOrder} not met (subtotal ${subtotal})`)
            } else if (!promo.max_uses || promo.current_uses < promo.max_uses) {
                promoCodeId = promo.id

                if (promo.promo_type === 'percentage_off') {
                    discount = Math.min(subtotal * (promo.value / 100), promo.max_discount_amount ?? Infinity)
                } else if (promo.promo_type === 'amount_off') {
                    discount = Math.min(promo.value, subtotal)
                } else if (promo.promo_type === 'free_item' && promo.free_item_id) {
                    // Insert free item at unit_price 0 — it doesn't add to subtotal,
                    // so no separate discount is needed (the 0 price IS the discount)
                    await supabase.from('order_items').insert({
                        order_id: orderId, menu_item_id: promo.free_item_id,
                        quantity: 1, unit_price: 0, special_request: 'FREE (promo)',
                    })
                } else if (promo.promo_type === 'bogo' && promo.bogo_buy_item_id && promo.bogo_get_item_id) {
                    // Customer gets bogo_get_item free for every bogo_buy_item ordered.
                    // Insert the free item at unit_price 0 — no additional discount needed.
                    const buyItemInOrder = payload.find(p => p.menu_item_id === promo.bogo_buy_item_id)
                    if (buyItemInOrder) {
                        await supabase.from('order_items').insert({
                            order_id: orderId, menu_item_id: promo.bogo_get_item_id,
                            quantity: buyItemInOrder.quantity, unit_price: 0, special_request: 'BOGO FREE',
                        })
                    }
                }

                // Increment usage counter
                void supabase.from('promo_codes').update({ current_uses: (promo.current_uses ?? 0) + 1 }).eq('id', promo.id)
            }
        }
    }

    if (loyaltyDiscount && loyaltyDiscount > 0) {
        discount += loyaltyDiscount
    }

    const { data: settings } = await supabase
        .from('settings')
        .select('features_v2')
        .eq('restaurant_id', restaurantId)
        .single()
    const featuresV2 = settings?.features_v2 as any
    const taxRate = Number(featuresV2?.defaultTaxRate ?? 0)
    const scEnabled = featuresV2?.serviceChargeEnabled === true
    const scRate = Number(featuresV2?.serviceChargeRate ?? 10)

    const serviceCharge = scEnabled 
        ? Math.round((subtotal - discount) * (scRate / 100) * 100) / 100 
        : 0

    const tax = Math.round((subtotal - discount + serviceCharge) * (taxRate / 100) * 100) / 100
    const total = Math.max(0, subtotal - discount + serviceCharge + tax)

    const { error: totalsUpdateError } = await supabase
        .from('orders')
        .update({
            subtotal_amount: subtotal,
            discount_amount: discount,
            service_charge_amount: serviceCharge,
            tax_amount: tax,
            total_amount: total,
            promo_code_id: promoCodeId,
        })
        .eq('id', orderId)

    if (totalsUpdateError) {
        console.error('Fallback order totals update failed:', totalsUpdateError)
    }

    const [pricingFb, deductFb] = await Promise.allSettled([
        supabase.rpc('apply_pricing_rules_to_order', { p_order_id: orderId }),
        supabase.rpc('deduct_ingredients_for_order',  { p_order_id: orderId }),
    ])
    if (pricingFb.status === 'rejected') console.error('[fallback]', orderId, 'apply_pricing failed:', pricingFb.reason)
    if (deductFb.status === 'rejected') console.error('[fallback]', orderId, 'deduct_ingredients failed:', deductFb.reason)
    else if (deductFb.status === 'fulfilled' && deductFb.value?.error) console.error('[fallback]', orderId, 'deduct_ingredients RPC error:', deductFb.value.error)

    return {
        orderId,
        subtotal,
        discount,
        tax,
        total,
        pointsEarned: 0,
    }
}
