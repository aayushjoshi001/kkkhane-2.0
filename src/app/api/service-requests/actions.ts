'use server'

import { createAdminClient } from '@/lib/supabase/server'
import type { ServiceRequestType } from '@/types/database'
import { verifyClientIp } from '@/lib/ip-check'

export async function createServiceRequest(
    sessionId: string,
    restaurantId: string,
    requestType: ServiceRequestType,
    message?: string
): Promise<{ success: boolean; error?: string }> {
    const { allowed } = await verifyClientIp(restaurantId, 'customer')
    if (!allowed) {
        return { success: false, error: 'Your current network IP is not allowed to send requests for this restaurant.' }
    }

    const supabase = await createAdminClient()

    // Rate limit: max 3 pending requests per session
    const { count } = await supabase
        .from('service_requests')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('status', 'pending')

    if (count && count >= 3) {
        return { success: false, error: 'You have too many pending requests. Please wait for a response.' }
    }

    if (requestType === 'request_bill') {
        // Prevent requesting bill if there are pending/preparing/ready orders
        const { count: activeOrders } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true })
            .eq('session_id', sessionId)
            .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
        
        if (activeOrders && activeOrders > 0) {
            return { success: false, error: 'You still have orders being prepared or waiting to be delivered! Please wait before requesting the bill.' }
        }
    }

    const { error } = await supabase
        .from('service_requests')
        .insert({
            session_id: sessionId,
            restaurant_id: restaurantId,
            request_type: requestType,
            message: message || null,
        })

    if (error) {
        console.error('Service request error:', error)
        return { success: false, error: 'Failed to send request. Please try again.' }
    }

    return { success: true }
}

export async function requestSessionOpen(
    tableId: string,
    restaurantId: string
): Promise<{ success: boolean; error?: string }> {
    const { allowed } = await verifyClientIp(restaurantId, 'customer')
    if (!allowed) {
        return { success: false, error: 'Your current network IP is not allowed to send requests for this restaurant.' }
    }

    const supabase = await createAdminClient()

    // Rate limit: 1 pending open_session request per table at a time
    const { count } = await supabase
        .from('service_requests')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', tableId)
        .eq('request_type', 'open_session')
        .eq('status', 'pending')

    if (count && count >= 1) {
        return { success: false, error: 'Request already sent. Your waiter is on the way!' }
    }

    const { error } = await supabase
        .from('service_requests')
        .insert({
            session_id: null,
            table_id: tableId,
            restaurant_id: restaurantId,
            request_type: 'open_session',
        })

    if (error) {
        console.error('Request session open error:', error)
        return { success: false, error: 'Failed to send request. Please try again.' }
    }

    return { success: true }
}

export async function acknowledgeServiceRequest(
    requestId: string,
    userId: string
): Promise<{ success: boolean; error?: string; conflict?: boolean }> {
    const supabase = await createAdminClient()

    // "I am going" — claim atomically: only a still-pending, unclaimed request flips.
    const { data, error } = await supabase
        .from('service_requests')
        .update({
            status: 'acknowledged',
            acknowledged_by: userId,
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .is('acknowledged_by', null)
        .select('id')

    if (error) {
        return { success: false, error: 'Failed to acknowledge request.' }
    }
    if (!data || data.length === 0) {
        return { success: false, conflict: true, error: 'Another waiter already took this' }
    }
    return { success: true }
}

export async function completeServiceRequest(
    requestId: string,
    userId?: string
): Promise<{ success: boolean; error?: string; conflict?: boolean }> {
    const supabase = await createAdminClient()

    // Only the waiter who took it (or an unclaimed request) may mark it served.
    let query = supabase
        .from('service_requests')
        .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .neq('status', 'completed')

    if (userId) query = query.or(`acknowledged_by.eq.${userId},acknowledged_by.is.null`)

    const { data, error } = await query.select('id')

    if (error) {
        return { success: false, error: 'Failed to complete request.' }
    }
    if (!data || data.length === 0) {
        return { success: false, conflict: true, error: 'Only the waiter who took this can mark it served' }
    }
    return { success: true }
}

/**
 * Customer billing — "Send a waiter to collect cash at the table".
 * Creates a single bill request the waiter feed already surfaces (with claim
 * ownership), then the customer polls getCashCollectionStatus for "on the way".
 */
export async function requestCashCollection(
    sessionId: string,
    restaurantId: string
): Promise<{ success: boolean; error?: string }> {
    const { allowed } = await verifyClientIp(restaurantId, 'customer')
    if (!allowed) {
        return { success: false, error: 'Your current network IP is not allowed to send requests for this restaurant.' }
    }
    const supabase = await createAdminClient()

    // One pending bill request per session is enough.
    const { count } = await supabase
        .from('service_requests')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', sessionId)
        .eq('request_type', 'request_bill')
        .in('status', ['pending', 'acknowledged'])

    if (count && count >= 1) return { success: true }

    const { error } = await supabase
        .from('service_requests')
        .insert({
            session_id: sessionId,
            restaurant_id: restaurantId,
            request_type: 'request_bill',
            message: 'Ready to pay — cash at table',
        })

    if (error) {
        console.error('requestCashCollection error:', error)
        return { success: false, error: 'Failed to notify a waiter. Please try again.' }
    }
    return { success: true }
}

export async function getCashCollectionStatus(
    sessionId: string
): Promise<{ state: 'none' | 'pending' | 'on_the_way' | 'done'; waiterName?: string }> {
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('service_requests')
        .select('status, acknowledged_by')
        .eq('session_id', sessionId)
        .eq('request_type', 'request_bill')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

    if (!data) return { state: 'none' }
    if (data.status === 'completed') return { state: 'done' }
    if (data.status === 'acknowledged') {
        let waiterName: string | undefined
        if (data.acknowledged_by) {
            const { data: u } = await supabase.from('users').select('full_name').eq('id', data.acknowledged_by).maybeSingle()
            waiterName = u?.full_name ?? undefined
        }
        return { state: 'on_the_way', waiterName }
    }
    return { state: 'pending' }
}
