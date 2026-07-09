import { createClient } from '@/lib/supabase/client'

export const fetchMenuData = async (restaurantId: string) => {
    const supabase = createClient()
    const [categories, items, ingredients] = await Promise.all([
        supabase.from('menu_categories').select('*').eq('restaurant_id', restaurantId).order('sort_order', { ascending: true }),
        supabase.from('menu_items').select('*, variations:menu_item_variations(*)').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true })
    ])
    return { 
        categories: categories.data || [], 
        items: items.data || [], 
        ingredients: ingredients.data || [] 
    }
}

export const fetchTablesData = async (restaurantId: string) => {
    const supabase = createClient()
    // `label` is the real sort column (there is no `table_number`), and
    // deleteTableAction soft-deletes via is_active — both match the
    // server-rendered query in app/(admin)/admin/tables/page.tsx.
    const { data } = await supabase.from('tables')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .order('label', { ascending: true })
    return data || []
}

export const fetchStaffData = async (restaurantId: string) => {
    const supabase = createClient()
    // Staff accounts live in `users` (there is no `staff` table) — same select
    // shape as the server-rendered query in app/(admin)/admin/staff/page.tsx,
    // including the customer exclusion, so the client refetch matches what SSR
    // originally rendered.
    const [staff, departments, invitations] = await Promise.all([
        supabase.from('users')
            .select(`
                id,
                full_name,
                avatar_url,
                is_active,
                role_id,
                email,
                department_id,
                monthly_salary,
                created_at,
                roles (
                    id,
                    name,
                    description
                ),
                departments (
                    id,
                    name
                )
            `)
            .eq('restaurant_id', restaurantId)
            .neq('role_id', 5) // Exclude standard customers from the staff dashboard
            .order('created_at', { ascending: false }),
        supabase.from('departments').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        // Invitations, not `staff_invitations` — matches app/(admin)/admin/staff/page.tsx.
        supabase.from('invitations')
            .select('id, email, role_id, department_id, status, expires_at, created_at, roles(id, name, description), departments(id, name), invited_by(id, full_name)')
            .eq('restaurant_id', restaurantId)
            .order('created_at', { ascending: false })
    ])
    return {
        staff: staff.data || [],
        departments: departments.data || [],
        invitations: invitations.data || []
    }
}

export const fetchSettingsData = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('restaurants').select('*').eq('id', restaurantId).single()
    return data
}

export const fetchTakeoutOrders = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('takeout_orders').select('*, items:takeout_order_items(*)').eq('restaurant_id', restaurantId).in('status', ['placed', 'confirmed', 'preparing', 'ready_for_pickup']).order('created_at', { ascending: false })
    return data || []
}

export const fetchCombosData = async (restaurantId: string) => {
    const supabase = createClient()
    const [combos, items] = await Promise.all([
        supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).eq('is_combo', true).order('name', { ascending: true }),
        supabase.from('combo_items').select('*, menu_item:menu_items(*)').eq('restaurant_id', restaurantId)
    ])
    return { combos: combos.data || [], comboItems: items.data || [] }
}

export const fetchIngredientsData = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('ingredients').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true })
    return data || []
}

export const fetchPricingRules = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('pricing_rules').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
    return data || []
}

export const fetchPromoCodes = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('promo_codes').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
    return data || []
}

export const fetchReportsData = async (restaurantId: string) => {
    const supabase = createClient()
    const { data } = await supabase.from('reports').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
    return data || []
}
