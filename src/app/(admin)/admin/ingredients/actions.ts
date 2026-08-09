'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { sendLowStockAlertEmail } from '@/lib/email'
import { requireRole } from '@/lib/auth'

/**
 * Checks for low-stock ingredients and emails the manager.
 * Called after ingredient deduction on every order placement.
 * Rate-limited by checking alert_sent_at to avoid spam.
 */
export async function checkAndAlertLowStock(restaurantId: string): Promise<void> {
    const supabase = await createAdminClient()

    // Cooldown: skip if we alerted within the last hour to prevent email spam
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('name, low_stock_alerted_at')
        .eq('id', restaurantId)
        .single()

    const lastAlerted = (restaurant as { low_stock_alerted_at?: string | null } | null)?.low_stock_alerted_at
    if (lastAlerted && Date.now() - new Date(lastAlerted).getTime() < 60 * 60 * 1000) return

    // Supabase JS can't do column-to-column comparisons, so fetch and filter in JS
    const { data: allIngredients } = await supabase
        .from('ingredients')
        .select('name, stock_quantity, reorder_level, unit')
        .eq('restaurant_id', restaurantId)
        .gt('reorder_level', 0)

    const belowThreshold = (allIngredients || []).filter(
        i => (i.stock_quantity ?? 0) <= (i.reorder_level ?? 0)
    )

    if (belowThreshold.length === 0) return

    // Get manager/owner contact email
    const { data: managers } = await supabase
        .from('users')
        .select('email, roles(name)')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .in('role_id', [1, 2]) // super_admin (1) or manager (2)
        .limit(1)

    const managerEmail = managers?.[0]?.email
    if (!managerEmail) return

    const restaurantName = (restaurant as { name?: string } | null)?.name ?? 'Restaurant'

    // Mark alert sent before sending (prevents duplicate sends on concurrent requests)
    void supabase
        .from('restaurants')
        .update({ low_stock_alerted_at: new Date().toISOString() })
        .eq('id', restaurantId)

    void sendLowStockAlertEmail(managerEmail, restaurantName, belowThreshold)
}

export async function getIngredientsAction(restaurantId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data } = await supabase
        .from('ingredients')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true })
    return { data: data || [] }
}

export async function createIngredientAction(input: {
    restaurant_id: string
    name: string
    unit: string
    stock_quantity: number
    reorder_level: number
    cost_per_unit: number
    supplier?: string | null
    category_id?: string | null
}) {
    const user = await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('ingredients')
        .insert(input)
        .select()
        .single()
    if (error) return { error: error.message }

    // A brand-new item's starting stock is set directly on the row rather
    // than going through addStockMovementAction (no prior quantity to add a
    // delta to) — log it as its own movement anyway, so "who brought this
    // item into stock and when" shows up in Inventory Activities the same
    // as any later restock, instead of the item just silently appearing.
    if (input.stock_quantity > 0) {
        const { error: moveErr } = await supabase
            .from('ingredient_movements')
            .insert({
                ingredient_id: data.id,
                movement_type: 'purchase',
                quantity: input.stock_quantity,
                notes: input.supplier ? `Initial stock — supplier: ${input.supplier}` : 'Initial stock on item creation',
                performed_by: user.id,
            })
        if (moveErr) console.error('Failed to log initial stock movement:', moveErr)
    }

    revalidatePath('/admin/ingredients')
    return { data }
}

export async function updateIngredientAction(id: string, updates: Record<string, unknown>) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error } = await supabase.from('ingredients').update(updates).eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/admin/ingredients')
    return { success: true }
}

export async function createIngredientCategoryAction(input: {
    restaurant_id: string
    name: string
    description?: string
    parent_id?: string | null
}) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('expense_categories')
        .insert({
            restaurant_id: input.restaurant_id,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            parent_id: input.parent_id || null,
            is_active: true,
            is_stock_category: true
        })
        .select()
        .single()
    if (error) return { error: error.message }
    return { data }
}

export async function createIngredientSupplierAction(input: {
    restaurant_id: string
    name: string
    phone?: string
    address?: string
    category_id?: string | null
}) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            restaurant_id: input.restaurant_id,
            name: input.name.trim(),
            phone: input.phone?.trim() || null,
            address: input.address?.trim() || null,
            category_id: input.category_id || null,
            is_active: true
        })
        .select()
        .single()
    if (error) return { error: error.message }
    return { data }
}

export async function addStockMovementAction(input: {
    ingredient_id: string
    movement_type: string
    quantity: number
    notes?: string
}) {
    const user = await requireRole('manager', 'super_admin', 'cashier')
    const supabase = await createAdminClient()

    // Insert movement record — performed_by always comes from the
    // authenticated session, never the client, so the Inventory Activities
    // log can trust who actually entered each movement.
    const { error: moveErr } = await supabase
        .from('ingredient_movements')
        .insert({ ...input, performed_by: user.id })
    if (moveErr) return { error: moveErr.message }

    // Update stock. Applied as a single atomic UPDATE inside the database —
    // reading the quantity here and writing back read + delta would lose one
    // of two movements recorded at the same time.
    const isAddition = input.movement_type === 'purchase' || input.movement_type === 'adjustment'
    const delta = isAddition ? input.quantity : -input.quantity
    const { error: stockErr } = await supabase.rpc('adjust_ingredient_stock', {
        p_ingredient_id: input.ingredient_id,
        p_delta: delta
    })

    if (stockErr) return { error: stockErr.message }

    revalidatePath('/admin/ingredients')
    return { success: true }
}

export async function deleteIngredientAction(id: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { error } = await supabase.from('ingredients').delete().eq('id', id)
    if (error) return { error: error.message }
    revalidatePath('/admin/ingredients')
    return { success: true }
}
