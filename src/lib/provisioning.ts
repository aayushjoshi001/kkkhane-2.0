// lib/provisioning.ts
// Single, shared path for bringing a new restaurant into existence.
// Currently only the authenticated onboarding flow
// (src/app/(onboarding)/onboarding/create/actions.ts) calls this — signup
// (src/app/signup/actions.ts) only creates the auth user and signs them in,
// then hands off to /onboarding to collect restaurant details. Kept as a
// standalone, reusable function in case a future direct signup-with-restaurant
// flow needs it too. Wherever it's called from, provisionRestaurant() ensures
// a restaurant is *never* born without the rows the rest of the app assumes
// exist: a users row, settings, a starter menu, and physical tables with QR
// tokens (so the /t/[qr_token] customer flow resolves).
//
// Atomicity: inserts run sequentially via the service-role admin client; if any
// step fails we roll back the restaurant (cascades to its child rows) following
// the same pattern already used in signup. (A single Postgres RPC would give
// true transactional atomicity — tracked as optional hardening in
// docs/FLOW_INTEGRATION_PLAN.md.)

import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import {
    type Tier,
    TIER_LIMITS,
    DEFAULT_THEME,
    DEFAULT_FEATURES_V1,
    buildFeaturesV2,
} from '@/lib/tiers'
import { getBusinessMode } from '@/lib/businessMode'
import type { StationKind } from '@/lib/stations'

const MANAGER_ROLE_ID = 2 // roles: 1=super_admin 2=manager 3=kitchen 4=waiter 5=customer
const DEFAULT_TABLE_COUNT = 6

export interface ProvisionInput {
    /** Existing auth user id (created by signup before calling, or already logged in for onboarding). */
    ownerId: string
    ownerEmail: string
    ownerName: string
    name: string
    slug: string
    contactPhone?: string | null
    address?: string | null
    /** Restaurant category selected during onboarding (FastFood/Hotel/Cafe/etc). */
    businessType?: string | null
    tier?: Tier
    // Optional signup-only business fields
    contactEmail?: string | null
    slogan?: string | null
    telephone?: string | null
    panNumber?: string | null
    vatRegistered?: boolean
    vatNumber?: string | null
    latitude?: number | null
    longitude?: number | null
    /** Seed starter menu + tables. Default true. */
    seedSample?: boolean
    /** Number of tables to create when seeding. Default 6. */
    tableCount?: number
}

export interface ProvisionResult {
    restaurantId?: string
    error?: string
    field?: string
}

/** Starter menu seeded so the dashboard + customer menu aren't empty on day one. */
const SAMPLE_MENU: Array<{ category: string; station?: StationKind; items: Array<{ name: string; description: string; price: number }> }> = [
    {
        category: 'Starters',
        items: [
            { name: 'Veg Momo', description: 'Steamed dumplings with seasonal vegetables', price: 150 },
            { name: 'Chicken Chilli', description: 'Spicy stir-fried chicken', price: 280 },
        ],
    },
    {
        category: 'Main Course',
        items: [
            { name: 'Chicken Thali', description: 'Rice, lentils, curry and sides', price: 350 },
            { name: 'Veg Fried Rice', description: 'Wok-tossed rice with vegetables', price: 220 },
        ],
    },
    {
        // Drinks are made at the bar, so their tickets route to the BOT queue
        // out of the box — a new venue sees the split working with no setup.
        category: 'Beverages',
        station: 'bar',
        items: [
            { name: 'Milk Tea', description: 'Classic Nepali milk tea', price: 60 },
            { name: 'Fresh Lime Soda', description: 'Sweet or salted', price: 90 },
        ],
    },
]

export async function provisionRestaurant(input: ProvisionInput): Promise<ProvisionResult> {
    const supabase = await createAdminClient()
    const tier: Tier = input.tier ?? 'free'
    const mode = getBusinessMode(input.businessType)
    const limits = TIER_LIMITS[tier]
    const seed = input.seedSample !== false
    // Delivery-only operations (Cloud Kitchen) have no dining room — seed zero tables.
    const tableCount = mode === 'delivery_only' ? 0 : (input.tableCount ?? DEFAULT_TABLE_COUNT)

    // Guard: slug must be unique (callers also check, but keep the invariant here).
    const { data: existingSlug } = await supabase
        .from('restaurants').select('id').eq('slug', input.slug).maybeSingle()
    if (existingSlug) {
        return { error: 'That restaurant URL is already taken. Please choose another.', field: 'restaurantName' }
    }

    let restaurantId: string | null = null

    try {
        // 1. Restaurant
        const { data: restaurant, error: restaurantError } = await supabase
            .from('restaurants')
            .insert({
                owner_id: input.ownerId,
                name: input.name,
                slug: input.slug,
                contact_email: input.contactEmail || input.ownerEmail,
                contact_phone: input.contactPhone || null,
                address: input.address || null,
                business_type: input.businessType || null,
                slogan: input.slogan || null,
                telephone: input.telephone || null,
                pan_number: input.panNumber || null,
                vat_registered: input.vatRegistered ?? false,
                vat_number: input.vatNumber || null,
                latitude: input.latitude ?? null,
                longitude: input.longitude ?? null,
                subscription_tier: tier,
                subscription_status: 'active',
                max_staff: limits.max_staff,
                max_menu_items: limits.max_menu_items,
                max_tables: limits.max_tables,
            })
            .select('id')
            .single()

        if (restaurantError || !restaurant) {
            throw new Error(restaurantError?.message || 'Failed to create restaurant.')
        }
        restaurantId = restaurant.id
        const rid: string = restaurant.id

        // 2. Owner users row (full_name is NOT NULL — always set it)
        const { error: userRowError } = await supabase.from('users').upsert({
            id: input.ownerId,
            restaurant_id: rid,
            full_name: input.ownerName || input.ownerEmail,
            email: input.ownerEmail,
            role_id: MANAGER_ROLE_ID,
            is_active: true,
        }, { onConflict: 'id' })
        if (userRowError) throw new Error(userRowError.message)

        // 3. Settings
        const { error: settingsError } = await supabase.from('settings').insert({
            restaurant_id: rid,
            theme: DEFAULT_THEME,
            features: DEFAULT_FEATURES_V1,
            features_v2: buildFeaturesV2(tier, mode),
            business_hours: null,
        })
        if (settingsError) throw new Error(settingsError.message)

        // 4. Seed starter menu + tables so the app is usable immediately.
        if (seed) {
            await seedStarterData(supabase, rid, tableCount)
        }

        return { restaurantId: rid }
    } catch (err) {
        // Roll back the restaurant; FK cascades clean up child rows.
        if (restaurantId) await supabase.from('restaurants').delete().eq('id', restaurantId)
        return { error: err instanceof Error ? err.message : 'Failed to create restaurant.' }
    }
}

/**
 * Seed default menu categories/items and tables. Best-effort: seeding failures
 * are surfaced as thrown errors so provisionRestaurant() can roll back.
 * qr_token and table label uniqueness are handled by DB defaults/constraints.
 */
async function seedStarterData(
    supabase: SupabaseClient,
    restaurantId: string,
    tableCount: number,
): Promise<void> {
    // Categories
    const categoryRows = SAMPLE_MENU.map((c, i) => ({
        restaurant_id: restaurantId,
        name: c.category,
        sort_order: i,
        is_visible: true,
        station: c.station ?? 'kitchen',
    }))
    const { data: insertedCategories, error: catError } = await supabase
        .from('menu_categories')
        .insert(categoryRows)
        .select('id, name')
    if (catError) throw new Error(`Seed categories failed: ${catError.message}`)

    const catIdByName = new Map<string, string>(
        (insertedCategories || []).map(c => [c.name as string, c.id as string]),
    )

    // Items
    const itemRows = SAMPLE_MENU.flatMap(c =>
        c.items.map(item => ({
            restaurant_id: restaurantId,
            category_id: catIdByName.get(c.category) ?? null,
            name: item.name,
            description: item.description,
            price: item.price,
            is_available: true,
        })),
    )
    const { error: itemError } = await supabase.from('menu_items').insert(itemRows)
    if (itemError) throw new Error(`Seed menu items failed: ${itemError.message}`)

    // Generate qr_token in JS — the DB default uses encode(...,'base64url'), which
    // this Postgres version rejects ("unrecognized encoding: base64url"). Node's
    // base64url is fine; this matches how addTableAction supplies the token.
    // tableCount is 0 for delivery-only restaurants — skip the insert entirely
    // rather than calling .insert([]) on an empty array.
    if (tableCount > 0) {
        const tableRows = Array.from({ length: tableCount }, (_, i) => ({
            restaurant_id: restaurantId,
            label: `T${i + 1}`,
            qr_token: randomBytes(18).toString('base64url'),
        }))
        const { error: tableError } = await supabase.from('tables').insert(tableRows)
        if (tableError) throw new Error(`Seed tables failed: ${tableError.message}`)
    }
}
