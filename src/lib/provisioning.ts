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
import { TRIAL_TIER, TRIAL_STATUS, trialExpiryFrom } from '@/lib/trial'
import { getBusinessMode, type BusinessMode } from '@/lib/businessMode'
import type { StationKind } from '@/lib/stations'

const MANAGER_ROLE_ID = 2 // roles: 1=super_admin 2=manager 3=kitchen 4=waiter 5=customer
const DEFAULT_TABLE_COUNT = 6

/**
 * Starter room categories for a hotel.
 *
 * A restaurant was provisioned able to trade — a menu to sell and tables to
 * seat — while a hotel got the same menu and tables and nothing at all for the
 * rooms it actually lets. That was not merely an empty screen: POST /api/rooms
 * rejects a room with no type ("Room number and Room Type are required"), and
 * no type existed, so the first thing a new hotel had to do was work out that
 * rooms hang off a category it had to invent first.
 *
 * Two are enough to make the Add Room form usable on day one and to show what a
 * category is for. base_price stays 0 so nobody bills a guest at a rate this
 * file guessed — the hotel sets its own, and the room form makes the price
 * obvious. Renaming or deleting these is a click; needing them and finding none
 * is a dead end.
 */
const SAMPLE_ROOM_TYPES: Array<{ name: string; capacity: number; description: string }> = [
    { name: 'Standard', capacity: 2, description: 'Standard room — set your own rate and amenities.' },
    { name: 'Deluxe', capacity: 3, description: 'Larger room — set your own rate and amenities.' },
]

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
    /**
     * Start this tenant on the 14-day full-access trial, overriding `tier`.
     *
     * Opt-in rather than the default because only self-serve onboarding earns a
     * trial. A demo tenant and a tenant a super admin creates by hand both come
     * with a deliberate plan already chosen, and silently converting those into
     * expiring platinum would suspend or downgrade them a fortnight later.
     */
    trial?: boolean
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

/** A main category with its default subcategories — one level of grouping on
 *  the shared expense_categories table (main has parent_id null, subs point
 *  back at it). `isStock` marks both the main and its subs as relevant to the
 *  Ingredients/Stock category picker, not just general Expense tracking. */
interface DefaultCategoryGroup {
    main: string
    isStock?: boolean
    subs: string[]
}

/** Default category tree covering common restaurant + hotel operating costs
 *  and ingredient/supply groups. Grouped so the Categories UI reads as
 *  "Grocery > Vegetables, Fruits, ..." instead of one long flat list. */
const DEFAULT_CATEGORY_GROUPS: DefaultCategoryGroup[] = [
    {
        main: 'Grocery',
        isStock: true,
        subs: [
            'Vegetables', 'Fruits', 'Dairy & Eggs', 'Meat & Poultry', 'Seafood & Fish',
            'Grains, Rice & Cereals', 'Pulses & Lentils', 'Spices & Condiments', 'Oils & Ghee',
            'Bakery & Bread', 'Frozen Foods', 'Sauces & Marinades', 'Dry Goods & Packaged Foods',
            'Confectionery & Desserts',
        ],
    },
    { main: 'Beverages', isStock: true, subs: ['Beverages (Non-Alcoholic)', 'Alcoholic Beverages'] },
    {
        main: 'Supplies',
        isStock: true,
        subs: ['Cleaning & Sanitation Supplies', 'Kitchen Supplies & Equipment', 'Packaging & Disposables', 'Housekeeping & Guest Supplies'],
    },
    { main: 'Utilities', subs: ['Electricity', 'Water', 'Gas / LPG', 'Internet & Telephone'] },
    { main: 'Staff & Payroll', subs: ['Staff Salaries & Wages', 'Staff Meals & Welfare'] },
    { main: 'Property & Facilities', subs: ['Rent / Lease', 'Repairs & Maintenance', 'Equipment & Furniture'] },
    { main: 'Operations', subs: ['Laundry Services', 'Transportation & Fuel'] },
    {
        main: 'Admin & Compliance',
        subs: [
            'Licenses & Permits', 'Insurance', 'Bank Charges & Fees',
            'Professional Fees (Legal/Accounting)', 'Taxes & Government Fees', 'Office & Administrative Supplies',
        ],
    },
    { main: 'Sales & Marketing', subs: ['Marketing & Advertising', 'Commission & Online Delivery Fees'] },
]

/** Standalone categories with no natural parent group — stay top-level. */
const DEFAULT_UNGROUPED_CATEGORIES: { name: string; isStock?: boolean }[] = [
    { name: 'Food & Beverage Purchases' },
    { name: 'Packaging & Takeaway Supplies' },
    { name: 'Miscellaneous / Other' },
    { name: 'Others', isStock: true },
    { name: 'Order Cancellation' },
]

export async function provisionRestaurant(input: ProvisionInput): Promise<ProvisionResult> {
    const supabase = await createAdminClient()
    // A trial tenant really is on TRIAL_TIER — the caps, the seeded feature
    // flags and every tier check downstream all read the same value, so nothing
    // below has to know a trial is what put it there. Only the status and the
    // expiry date mark it, and those are what the nightly job reads to end it.
    const onTrial = input.trial === true
    const tier: Tier = onTrial ? TRIAL_TIER : (input.tier ?? 'free')
    // One timestamp, written to both columns. They diverge later — the
    // downgrade clears the expiry and keeps the trial marker — but they must
    // start out agreeing or the countdown and the plan would disagree on the
    // day it ends.
    const trialEndsAt = onTrial ? trialExpiryFrom() : null
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
                subscription_status: onTrial ? TRIAL_STATUS : 'active',
                // Only ever set for a trial. A paid subscription leaves this
                // null until billing writes a real renewal date, and
                // auto-suspend only looks at rows that have one — so a null
                // here is what keeps a paying tenant from being suspended by a
                // date nobody set.
                subscription_expires_at: trialEndsAt,
                // Survives the downgrade that clears subscription_expires_at,
                // so the app can still tell a tenant whose trial just ran out
                // from one that has always been on Free.
                trial_ends_at: trialEndsAt,
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

        // Steps 2-4 each only need the restaurant id, so run them concurrently
        // instead of three sequential round-trips. Any rejection is caught below
        // and rolls the restaurant back (FK cascade cleans up whatever landed).
        //   2. Owner users row (full_name is NOT NULL — always set it)
        //   3. Settings
        //   4. Seed starter menu + tables so the app is usable immediately
        const [userRes, settingsRes] = await Promise.all([
            supabase.from('users').upsert({
                id: input.ownerId,
                restaurant_id: rid,
                full_name: input.ownerName || input.ownerEmail,
                email: input.ownerEmail,
                role_id: MANAGER_ROLE_ID,
                is_active: true,
            }, { onConflict: 'id' }),
            supabase.from('settings').insert({
                restaurant_id: rid,
                theme: DEFAULT_THEME,
                features: DEFAULT_FEATURES_V1,
                features_v2: buildFeaturesV2(tier, mode),
                business_hours: null,
            }),
            seed ? seedStarterData(supabase, rid, tableCount, mode) : Promise.resolve(),
        ])
        if (userRes.error) throw new Error(userRes.error.message)
        if (settingsRes.error) throw new Error(settingsRes.error.message)

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
    mode: BusinessMode,
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

    // Items depend on the category ids above; tables don't depend on either, so
    // once categories exist the items and tables inserts run concurrently.
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

    // Generate qr_token in JS — the DB default uses encode(...,'base64url'), which
    // this Postgres version rejects ("unrecognized encoding: base64url"). Node's
    // base64url is fine; this matches how addTableAction supplies the token.
    // tableCount is 0 for delivery-only restaurants — skip the insert entirely
    // rather than calling .insert([]) on an empty array.
    const tableRows = tableCount > 0
        ? Array.from({ length: tableCount }, (_, i) => ({
            restaurant_id: restaurantId,
            label: `T${i + 1}`,
            qr_token: randomBytes(18).toString('base64url'),
        }))
        : []

    // Main categories (e.g. "Grocery") must exist before their subcategories can
    // point parent_id at them, so insert those first and capture their ids.
    const mainRows = DEFAULT_CATEGORY_GROUPS.map(g => ({
        restaurant_id: restaurantId,
        name: g.main,
        is_stock_category: !!g.isStock,
    }))
    const { data: insertedMains, error: mainCatError } = await supabase
        .from('expense_categories')
        .insert(mainRows)
        .select('id, name')
    if (mainCatError) throw new Error(`Seed main categories failed: ${mainCatError.message}`)

    const mainIdByName = new Map<string, string>(
        (insertedMains || []).map(c => [c.name as string, c.id as string]),
    )

    const subCategoryRows = DEFAULT_CATEGORY_GROUPS.flatMap(g =>
        g.subs.map(name => ({
            restaurant_id: restaurantId,
            name,
            is_stock_category: !!g.isStock,
            parent_id: mainIdByName.get(g.main) ?? null,
        })),
    )
    const ungroupedCategoryRows = DEFAULT_UNGROUPED_CATEGORIES.map(u => ({
        restaurant_id: restaurantId,
        name: u.name,
        is_stock_category: !!u.isStock,
    }))

    // Only a hotel lets rooms, so only a hotel needs the categories they hang
    // off. Everything else here is shared, and none of these depend on each
    // other, so they go together.
    const roomTypeRows = mode === 'hotel'
        ? SAMPLE_ROOM_TYPES.map(t => ({
            restaurant_id: restaurantId,
            name: t.name,
            capacity: t.capacity,
            description: t.description,
        }))
        : []

    const [{ error: itemError }, tableRes, expenseCatRes, roomTypeRes] = await Promise.all([
        supabase.from('menu_items').insert(itemRows),
        tableRows.length ? supabase.from('tables').insert(tableRows) : Promise.resolve({ error: null }),
        supabase.from('expense_categories').insert([...subCategoryRows, ...ungroupedCategoryRows]),
        roomTypeRows.length ? supabase.from('room_types').insert(roomTypeRows) : Promise.resolve({ error: null }),
    ])
    if (itemError) throw new Error(`Seed menu items failed: ${itemError.message}`)
    if (tableRes.error) throw new Error(`Seed tables failed: ${tableRes.error.message}`)
    if (expenseCatRes.error) throw new Error(`Seed expense categories failed: ${expenseCatRes.error.message}`)
    if (roomTypeRes.error) throw new Error(`Seed room types failed: ${roomTypeRes.error.message}`)
}
