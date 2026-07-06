'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { invalidateCache } from '@/lib/redis'

export async function addCategoryAction(restaurantId: string, name: string, sortOrder: number, isVisible: boolean, imageUrl?: string | null) {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('menu_categories')
        .insert({
            restaurant_id: restaurantId,
            name,
            sort_order: sortOrder,
            is_visible: isVisible,
            image_url: imageUrl || null
        })
        .select()
        .single()

    if (error) return { error: error.message }
    await invalidateCache(`menu-data:${restaurantId}`)
    revalidatePath('/admin/menu')
    return { data }
}

export async function updateCategoryAction(id: string, updates: Record<string, unknown>) {
    const supabase = await createAdminClient()
    const { error } = await supabase
        .from('menu_categories')
        .update(updates)
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath('/admin/menu')
    return { success: true }
}

export async function deleteCategoryAction(id: string) {
    const supabase = await createAdminClient()
    const { error } = await supabase
        .from('menu_categories')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    revalidatePath('/admin/menu')
    return { success: true }
}

export async function addItemAction(
    item: Record<string, unknown>,
    variations?: { name: string; price: number; is_available?: boolean; image_url?: string | null }[],
    recipe?: { ingredient_id: string; quantity_needed: number }[]
) {
    const supabase = await createAdminClient()

    // Enforce plan menu item limit
    const restaurantId = item.restaurant_id as string
    const { data: restaurant } = await supabase
        .from('restaurants')
        .select('max_menu_items')
        .eq('id', restaurantId)
        .single()

    const maxItems = (restaurant as { max_menu_items?: number } | null)?.max_menu_items ?? 9999

    const { count: currentCount } = await supabase
        .from('menu_items')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)

    if ((currentCount ?? 0) >= maxItems) {
        return { error: `Menu item limit reached. Your plan allows ${maxItems} items. Upgrade to add more.` }
    }

    // Exclude variations from item object if present
    const { variations: _, ...itemData } = item

    const { data, error } = await supabase
        .from('menu_items')
        .insert(itemData)
        .select()
        .single()

    if (error) return { error: error.message }

    // Best-effort rollback of the just-created item (and any children written so
    // far) when a child insert fails. Without this the item is left orphaned and
    // the caller — which only reloads on `data` — silently drops it, so a retry
    // creates a duplicate.
    const rollbackItem = async () => {
        await supabase.from('recipes').delete().eq('menu_item_id', data.id)
        await supabase.from('menu_item_variations').delete().eq('menu_item_id', data.id)
        await supabase.from('menu_items').delete().eq('id', data.id)
    }

    // If recipe is provided, insert it
    if (recipe && recipe.length > 0) {
        const recipesToInsert = recipe.map(r => ({
            menu_item_id: data.id,
            ingredient_id: r.ingredient_id,
            quantity_needed: Number(r.quantity_needed)
        }))
        const { error: recipeError } = await supabase
            .from('recipes')
            .insert(recipesToInsert)

        if (recipeError) {
            console.error('Failed to save recipe:', recipeError)
            await rollbackItem()
            return { error: `Failed to save recipe: ${recipeError.message}` }
        }
    }

    // If variations are provided, insert them
    if (variations && variations.length > 0) {
        const variationsToInsert = variations.map(v => ({
            menu_item_id: data.id,
            name: v.name,
            price: Number(v.price),
            is_available: v.is_available ?? true,
            image_url: v.image_url || null
        }))
        const { error: varError } = await supabase
            .from('menu_item_variations')
            .insert(variationsToInsert)

        if (varError) {
            console.error('Failed to save variations:', varError)
            await rollbackItem()
            return { error: `Failed to save variations: ${varError.message}` }
        }
    }

    revalidatePath('/admin/menu')
    return { data }
}

export async function updateItemAction(
    id: string,
    updates: Record<string, unknown>,
    variations?: { id?: string; name: string; price: number; is_available?: boolean; image_url?: string | null }[],
    recipe?: { ingredient_id: string; quantity_needed: number }[]
) {
    const supabase = await createAdminClient()
    
    // Exclude variations from updates object if present
    const { variations: _, ...itemUpdates } = updates

    const { error } = await supabase
        .from('menu_items')
        .update(itemUpdates)
        .eq('id', id)

    if (error) return { error: error.message }

    // If recipe is provided, sync it. The delete-then-insert is not atomic, so
    // snapshot the existing rows first and restore them if the insert fails —
    // otherwise a transient error silently wipes the item's saved recipe.
    if (recipe) {
        const { data: prevRecipe } = await supabase
            .from('recipes')
            .select('ingredient_id, quantity_needed')
            .eq('menu_item_id', id)

        await supabase
            .from('recipes')
            .delete()
            .eq('menu_item_id', id)

        if (recipe.length > 0) {
            const recipesToInsert = recipe.map(r => ({
                menu_item_id: id,
                ingredient_id: r.ingredient_id,
                quantity_needed: Number(r.quantity_needed)
            }))
            const { error: recipeError } = await supabase
                .from('recipes')
                .insert(recipesToInsert)
            if (recipeError) {
                console.error('Failed to save recipe:', recipeError)
                // Restore the previous recipe so the edit doesn't lose it.
                if (prevRecipe && prevRecipe.length > 0) {
                    await supabase.from('recipes').insert(
                        prevRecipe.map(r => ({
                            menu_item_id: id,
                            ingredient_id: r.ingredient_id,
                            quantity_needed: r.quantity_needed
                        }))
                    )
                }
                return { error: `Failed to save recipe: ${recipeError.message}` }
            }
        }
    }

    // If variations are provided, sync them
    if (variations) {
        // 1. Get existing variations from DB to determine what to insert, update, or delete
        const { data: existingVars } = await supabase
            .from('menu_item_variations')
            .select('id')
            .eq('menu_item_id', id)

        const existingIds = (existingVars || []).map(v => v.id)
        const incomingIds = variations.filter(v => v.id).map(v => v.id!)

        // Deletions: existing but not incoming
        const toDelete = existingIds.filter(eid => !incomingIds.includes(eid))
        if (toDelete.length > 0) {
            await supabase
                .from('menu_item_variations')
                .delete()
                .in('id', toDelete)
        }

        // Inserts: no id
        const toInsert = variations
            .filter(v => !v.id)
            .map(v => ({
                menu_item_id: id,
                name: v.name,
                price: Number(v.price),
                is_available: v.is_available ?? true,
                image_url: v.image_url || null
            }))
        if (toInsert.length > 0) {
            await supabase
                .from('menu_item_variations')
                .insert(toInsert)
        }

        // Updates: has id and exists in existingIds
        const toUpdate = variations.filter(v => v.id && existingIds.includes(v.id))
        for (const v of toUpdate) {
            await supabase
                .from('menu_item_variations')
                .update({
                    name: v.name,
                    price: Number(v.price),
                    is_available: v.is_available ?? true,
                    image_url: v.image_url || null
                })
                .eq('id', v.id)
        }
    }

    revalidatePath('/admin/menu')
    return { success: true }
}

export async function getItemRecipeAction(menuItemId: string) {
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('recipes')
        .select('ingredient_id, quantity_needed, ingredients(name, unit)')
        .eq('menu_item_id', menuItemId)
    if (error) return { error: error.message }
    return { data }
}

export async function deleteItemAction(id: string) {
    const supabase = await createAdminClient()

    // 1. Check if the item has been ordered
    const { count, error: countErr } = await supabase
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .eq('menu_item_id', id)

    if (countErr) return { error: countErr.message }

    const isOrdered = (count ?? 0) > 0

    if (isOrdered) {
        // Soft delete since it has historical orders
        const { error: updateErr } = await supabase
            .from('menu_items')
            .update({ is_deleted: true, is_available: false, category_id: null })
            .eq('id', id)

        if (updateErr) {
            // Check if is_deleted column doesn't exist yet, try fallback update without it
            if (updateErr.message.includes('is_deleted') || updateErr.code === 'PGRST205' || updateErr.code === '42703') {
                const { error: fallbackErr } = await supabase
                    .from('menu_items')
                    .update({ is_available: false, category_id: null })
                    .eq('id', id)
                if (fallbackErr) return { error: fallbackErr.message }
            } else {
                return { error: updateErr.message }
            }
        }
    } else {
        // Hard delete since it has no orders
        const { error: deleteErr } = await supabase
            .from('menu_items')
            .delete()
            .eq('id', id)

        if (deleteErr) {
            // Fallback to soft delete in case of other hidden relations (e.g. combo items)
            const { error: updateErr } = await supabase
                .from('menu_items')
                .update({ is_deleted: true, is_available: false, category_id: null })
                .eq('id', id)

            if (updateErr) {
                if (updateErr.message.includes('is_deleted') || updateErr.code === 'PGRST205' || updateErr.code === '42703') {
                    const { error: fallbackErr } = await supabase
                        .from('menu_items')
                        .update({ is_available: false, category_id: null })
                        .eq('id', id)
                    if (fallbackErr) return { error: fallbackErr.message }
                } else {
                    return { error: updateErr.message }
                }
            }
        }
    }

    revalidatePath('/admin/menu')
    return { success: true }
}

