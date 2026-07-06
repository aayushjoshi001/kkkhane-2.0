import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getRestaurantFeatures, getMenuLayout } from '@/lib/features'
import { getCachedMenuData } from '@/lib/menu-cache'
import type { MenuItem } from '@/types/database'
import TablePageClient from './TablePageClient'
import { verifyClientIp } from '@/lib/ip-check'
import { getOrCreateActiveSession } from '@/lib/sessions'
import { getOptionalUser } from '@/lib/auth'

import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export async function generateMetadata(props: {
    params: Promise<{ tableSlug: string }>
}): Promise<Metadata> {
    const params = await props.params;
    const supabase = await createAdminClient()
    const { data: tableData } = await supabase
        .from('tables')
        .select('restaurant_id')
        .eq('qr_token', params.tableSlug)
        .single()

    if (tableData?.restaurant_id) {
        return {
            manifest: `/api/manifest/${tableData.restaurant_id}?start_url=${encodeURIComponent(`/t/${params.tableSlug}`)}`
        }
    }
    return {}
}

export default async function CustomerMenuPage(props: {
    params: Promise<{ tableSlug: string }>
    searchParams: Promise<{ s?: string; w?: string }>
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    // 1. Session & Table Validation
    const tableToken = params.tableSlug
    let sessionToken = searchParams.s
    const isWaiterMode = searchParams.w === '1'

    const supabase = await createAdminClient()

    // Find the table and restaurant ID
    const { data: tableData } = await supabase
        .from('tables')
        .select('id, restaurant_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
        .eq('qr_token', tableToken)
        .single()

    if (!tableData) return notFound()

    const restaurantId = tableData.restaurant_id

    // Track the session UUID (needed for FK references like service_requests.session_id)
    let sessionUUID: string | undefined

    // Find active session for this table (opened by waiter)
    if (!sessionToken) {
        const { data: existingSession } = await supabase
            .from('sessions')
            .select('id, session_token')
            .eq('table_id', tableData.id)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle()

        if (existingSession) {
            sessionToken = existingSession.session_token
            sessionUUID = existingSession.id
        }
        // If no active session, customer sees menu in view-only mode
        // They need to ask the waiter to open a session for their table
    } else {
        // Validate the provided session token is still active
        const { data: validSession } = await supabase
            .from('sessions')
            .select('id, session_token')
            .eq('session_token', sessionToken)
            .eq('status', 'active')
            .gt('expires_at', new Date().toISOString())
            .maybeSingle()

        if (!validSession) {
            sessionToken = undefined // Session expired or invalid
        } else {
            sessionUUID = validSession.id
        }
    }

    // 2. Fetch Menu Data + Feature Flags in parallel
    const [
        features,
        menuData,
        menuLayout,
        ipCheckResult,
        optionalUser
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        getCachedMenuData(restaurantId),
        getMenuLayout(restaurantId),
        verifyClientIp(restaurantId, 'customer'),
        isWaiterMode ? getOptionalUser() : Promise.resolve(null)
    ])

    const isIpRestricted = !ipCheckResult.allowed && !optionalUser

    // Optional "Waiter-Managed Sessions" feature (manager-toggleable, package-gated):
    //  • ON  → a waiter must open the table session before guests can order.
    //  • OFF → self-service: auto-open a session on QR scan so guests order instantly.
    const waiterSessionEnabled = features?.waiterSessionEnabled === true

    if (!sessionToken && !isIpRestricted && !waiterSessionEnabled) {
        const session = await getOrCreateActiveSession(supabase, tableData.id, restaurantId)
        if (session) {
            sessionToken = session.session_token
            sessionUUID = session.id
        }
    }

    const isValidSession = !!sessionToken

    const { categories, menuItems, translations, supportedLanguages, comboItems, pairings } = menuData

    // Always include English as first option if there are other languages
    const langs = supportedLanguages.length > 0
        ? [{ code: 'en', name: 'EN' }, ...supportedLanguages.filter(l => l.code !== 'en')]
        : []

    return (
        <TablePageClient
            tableData={{
                id: tableData.id,
                label: tableData.label,
                qr_token: tableToken,
                restaurant_id: tableData.restaurant_id,
                restaurants: Array.isArray(tableData.restaurants)
                    ? tableData.restaurants[0] || null
                    : (tableData.restaurants as unknown as { name: string; slug: string | null; logo_url: string | null; physical_menu_urls: string[] | null } | null),
            }}
            categories={categories || []}
            menuItems={menuItems}
            comboItems={comboItems || []}
            pairings={pairings}
            sessionToken={sessionToken}
            sessionUUID={sessionUUID}
            isValidSession={isValidSession}
            serviceRequestsEnabled={features?.serviceRequestsEnabled !== false}
            quickServeItems={(features as { quickServeItems?: string[] } | null)?.quickServeItems ?? []}
            waiterSessionEnabled={waiterSessionEnabled}
            selfOrderRequestEnabled={(features as { selfOrderRequestEnabled?: boolean } | null)?.selfOrderRequestEnabled !== false}
            multiLanguageEnabled={features?.multiLanguageEnabled === true}
            menuLayout={menuLayout}
            translations={translations}
            supportedLanguages={langs}
            isIpRestricted={isIpRestricted}
        />
    )
}
