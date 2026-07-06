import { createAdminClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getRestaurantFeatures, getMenuLayout } from '@/lib/features'
import { getCachedMenuData } from '@/lib/menu-cache'
import type { MenuItem } from '@/types/database'
import TablePageClient from './TablePageClient'
import { verifyClientIp } from '@/lib/ip-check'
import { getOrCreateActiveSession } from '@/lib/sessions'
import { getOptionalUser } from '@/lib/auth'
import { getHomepageConfig } from '@/lib/homepage'

import type { Metadata } from 'next'

export const revalidate = 600
export const runtime = 'edge'

export function generateStaticParams() {
    return []
}

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
}) {
    const params = await props.params;
    const tableToken = params.tableSlug

    const supabase = await createAdminClient()

    // Find the table and restaurant ID
    const { data: tableData } = await supabase
        .from('tables')
        .select('id, restaurant_id, label, restaurants(name, slug, logo_url, physical_menu_urls)')
        .eq('qr_token', tableToken)
        .single()

    if (!tableData) return notFound()

    const restaurantId = tableData.restaurant_id

    // 2. Fetch Menu Data + Feature Flags in parallel
    const [
        features,
        menuData,
        menuLayout,
        homepageConfig
    ] = await Promise.all([
        getRestaurantFeatures(restaurantId),
        getCachedMenuData(restaurantId),
        getMenuLayout(restaurantId),
        getHomepageConfig(restaurantId)
    ])

    const waiterSessionEnabled = features?.waiterSessionEnabled === true

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
            sessionToken={undefined}
            sessionUUID={undefined}
            isValidSession={false}
            serviceRequestsEnabled={features?.serviceRequestsEnabled !== false}
            quickServeItems={(features as { quickServeItems?: string[] } | null)?.quickServeItems ?? []}
            waiterSessionEnabled={waiterSessionEnabled}
            selfOrderRequestEnabled={(features as { selfOrderRequestEnabled?: boolean } | null)?.selfOrderRequestEnabled !== false}
            multiLanguageEnabled={features?.multiLanguageEnabled === true}
            menuLayout={menuLayout}
            translations={translations}
            supportedLanguages={langs}
            isIpRestricted={false}
            initialHomepageConfig={homepageConfig}
        />
    )
}
