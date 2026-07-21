import { notFound } from 'next/navigation'
import { getRestaurantFeatures, getMenuLayout } from '@/lib/features'
import { getCachedMenuData } from '@/lib/menu-cache'
import { getTableByToken } from '@/lib/tables'
import type { MenuItem } from '@/types/database'
import TablePageClient from './TablePageClient'
import { getHomepageConfig } from '@/lib/homepage'
import { getRoomContextForTable } from '@/lib/rooms'
import RoomNotCheckedIn from '@/components/customer/RoomNotCheckedIn'
import RoomGuestVerify from './RoomGuestVerify'
import RoomServiceCallButton from './RoomServiceCallButton'
import { roomVerifyCookieName } from '@/lib/roomGuest'
import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/server'

import type { Metadata } from 'next'

// This route must render dynamically. Two things in its data path are
// request-dynamic and throw under a static/ISR render:
//   1. fetchWithCache -> the Upstash SDK issues fetch(..., {cache: 'no-store'}),
//      which trips "Page changed from static to dynamic at runtime".
//   2. getHomepageConfig previously read cookies() -> DYNAMIC_SERVER_USAGE.
// It was previously declared `revalidate = 600` with a generateStaticParams that
// returns [], so nothing was ever prerendered and every request was a cache MISS
// anyway — the ISR declaration bought no cache hits and 500'd the page whenever
// the Redis hot-read cache missed. Read caching still comes from Upstash.
//
// `runtime = 'edge'` is not an option either: this page transitively imports
// getOrCreateActiveSession from @/lib/sessions, which uses Node's `crypto`.
export const dynamic = 'force-dynamic'

export async function generateMetadata(props: {
    params: Promise<{ tableSlug: string }>
}): Promise<Metadata> {
    const params = await props.params;
    const tableData = await getTableByToken(params.tableSlug)

    if (tableData?.restaurant_id) {
        return {
            manifest: `/api/manifest/${tableData.restaurant_id}?start_url=${encodeURIComponent(`/t/${params.tableSlug}`)}`
        }
    }
    return {}
}

import { Suspense } from 'react'
import Image from 'next/image'
import { UtensilsCrossed, UserCircle, Loader2 } from 'lucide-react'

// The Skeleton mimics the exact Header of the TablePageClient, but shows a spinner in the main content area
function TablePageClientSkeleton({ tableData }: { tableData: any }) {
    const restaurantName = tableData.restaurants?.name || 'Restaurant'
    const logoUrl = tableData.restaurants?.logo_url

    return (
        <div className="min-h-screen bg-surface-muted pb-20 animate-pulse">
            <header className="relative bg-brand-500 text-white rounded-b-[36px] sticky top-0 z-40 pb-6 pt-2 shadow-md flex flex-col gap-2">
                <div className="absolute inset-x-0 bottom-0 top-[48px] rounded-b-[36px] overflow-hidden z-0">
                    <div className="absolute inset-0 bg-brand-500/15 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
                </div>

                <div className="max-w-2xl mx-auto w-full px-4 flex items-center justify-between gap-3 h-10 relative z-10">
                    <div className="flex items-center gap-2 shrink-0">
                        {logoUrl ? (
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-surface shrink-0 border border-white/25 shadow-sm">
                                <Image src={logoUrl} alt={restaurantName} fill className="object-cover" sizes="32px" />
                            </div>
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-surface/10 flex items-center justify-center shrink-0 border border-white/25 shadow-sm">
                                <UtensilsCrossed size={14} className="text-white" />
                            </div>
                        )}
                        <div className="flex flex-col">
                            <span className="text-[8px] text-white/70 uppercase font-black tracking-wide leading-none">Restaurant</span>
                            <span className="text-xs font-black tracking-tight truncate max-w-[120px] leading-tight">
                                {restaurantName}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 pr-1 opacity-50">
                        <div className="w-8 h-8 rounded-full bg-surface/10 flex items-center justify-center shrink-0 border border-white/25">
                            <UserCircle size={18} className="text-white" />
                        </div>
                        <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0 border-2 border-white overflow-hidden relative shadow-sm">
                            <Image src="/brand/kkkhane-k-logo.jpg" alt="kkkhane" fill className="object-cover scale-[1.45]" sizes="32px" />
                        </div>
                    </div>
                </div>

                <div className="w-full text-center pb-1 relative z-10 h-16" />

                <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2 w-[85%] max-w-md z-30">
                    <div className="h-10 bg-brand-50 rounded-full opacity-50 shadow-md" />
                </div>
            </header>

            <main className="max-w-2xl mx-auto px-4 pt-16 flex flex-col items-center justify-center min-h-[40vh]">
                <div className="w-16 h-16 bg-surface rounded-full shadow-lg flex items-center justify-center mb-6">
                    <Loader2 size={32} className="text-brand-500 animate-spin" />
                </div>
                <h2 className="text-xl font-black text-ink mb-2 tracking-tight">Preparing Menu</h2>
                <p className="text-sm font-bold text-ink-subtle">Just a moment...</p>
            </main>
        </div>
    )
}

async function MenuDataLoader({ 
    restaurantId, 
    tableData, 
    tableToken 
}: { 
    restaurantId: string; 
    tableData: any; 
    tableToken: string;
}) {
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

    // Room-service call button: only on a room's QR, only when the manager has
    // enabled it and set a reception number.
    const roomCallPhone = tableData.room_id && features?.roomServiceCallEnabled && features?.receptionPhone
        ? features.receptionPhone
        : null

    const { categories, menuItems, translations, supportedLanguages, comboItems, pairings } = menuData

    const langs = supportedLanguages.length > 0
        ? [{ code: 'en', name: 'EN' }, ...supportedLanguages.filter(l => l.code !== 'en')]
        : []

    return (
        <>
        <TablePageClient
            tableData={{
                id: tableData.id,
                label: tableData.label,
                qr_token: tableToken,
                restaurant_id: tableData.restaurant_id,
                room_id: tableData.room_id ?? null,
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
        </>
    )
}

export default async function CustomerMenuPage(props: {
    params: Promise<{ tableSlug: string }>
}) {
    const params = await props.params;
    const tableToken = params.tableSlug

    // Same lookup layout.tsx and generateMetadata already ran this request —
    // React.cache() returns their result instead of a third round-trip.
    const tableData = await getTableByToken(tableToken)

    if (!tableData) return notFound()

    // A room's QR only opens once a guest is checked in — otherwise the order
    // would belong to no stay and could never be billed. Ordinary dining tables
    // (room_id IS NULL) return null here and fall through untouched.
    const supabase = await createAdminClient()
    const roomContext = await getRoomContextForTable(supabase, tableData.id)
    if (roomContext && !roomContext.bookingId) {
        const restaurant = tableData.restaurants as unknown as { name?: string } | null
        return (
            <RoomNotCheckedIn
                roomNumber={roomContext.roomNumber || tableData.label}
                restaurantName={restaurant?.name}
            />
        )
    }

    // In-room service: when the manager has enabled it, a checked-in room's QR
    // must confirm the guest's booking phone before ordering opens. Verification
    // is remembered per-stay via an httpOnly cookie keyed to the booking. Only a
    // room with an active stay needs this check, so ordinary tables skip it.
    if (roomContext?.bookingId) {
        const features = await getRestaurantFeatures(tableData.restaurant_id)
        if (features?.roomServiceCallEnabled) {
            const verified = (await cookies()).get(roomVerifyCookieName(roomContext.bookingId))?.value === '1'
            if (!verified) {
                const restaurant = tableData.restaurants as unknown as { name?: string } | null
                return (
                    <RoomGuestVerify
                        tableId={tableData.id}
                        roomNumber={roomContext.roomNumber || tableData.label}
                        restaurantName={restaurant?.name}
                        receptionPhone={features?.receptionPhone ?? null}
                    />
                )
            }
        }
    }

    return (
        <Suspense fallback={<TablePageClientSkeleton tableData={tableData} />}>
            <MenuDataLoader restaurantId={tableData.restaurant_id} tableData={tableData} tableToken={tableToken} />
        </Suspense>
    )
}
