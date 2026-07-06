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
    const { data } = await supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('table_number', { ascending: true })
    return data || []
}

export const fetchStaffData = async (restaurantId: string) => {
    const supabase = createClient()
    const [staff, departments, invitations] = await Promise.all([
        supabase.from('staff').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('departments').select('*').eq('restaurant_id', restaurantId).order('name', { ascending: true }),
        supabase.from('staff_invitations').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
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
