'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { invalidateCache } from '@/lib/redis'
import type { StationKind } from '@/lib/stations'
import { requireRole } from '@/lib/auth'

export async function addCategoryAction(restaurantId: string, name: string, sortOrder: number, isVisible: boolean, imageUrl?: string | null, station: StationKind = 'kitchen') {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()
    const { data, error } = await supabase
        .from('menu_categories')
        .insert({
            restaurant_id: restaurantId,
            name,
            sort_order: sortOrder,
            is_visible: isVisible,
            image_url: imageUrl || null,
            station
        })
        .select()
        .single()

    if (error) return { error: error.message }
    await invalidateCache(`menu-data:${restaurantId}`)
    revalidateTag(`menu-data-${restaurantId}`, 'max')
    revalidatePath('/admin/menu')
    return { data }
}

export async function updateCategoryAction(id: string, updates: Record<string, unknown>) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: cat } = await supabase
        .from('menu_categories')
        .select('restaurant_id')
        .eq('id', id)
        .single()

    const { error } = await supabase
        .from('menu_categories')
        .update(updates)
        .eq('id', id)

    if (error) return { error: error.message }
    if (cat?.restaurant_id) {
        await invalidateCache(`menu-data:${cat.restaurant_id}`)
        revalidateTag(`menu-data-${cat.restaurant_id}`, 'max')
    }
    revalidatePath('/admin/menu')
    return { success: true }
}

export async function deleteCategoryAction(id: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: cat } = await supabase
        .from('menu_categories')
        .select('restaurant_id')
        .eq('id', id)
        .single()

    const { error } = await supabase
        .from('menu_categories')
        .delete()
        .eq('id', id)

    if (error) return { error: error.message }
    if (cat?.restaurant_id) {
        await invalidateCache(`menu-data:${cat.restaurant_id}`)
        revalidateTag(`menu-data-${cat.restaurant_id}`, 'max')
    }
    revalidatePath('/admin/menu')
    return { success: true }
}

/** One add-on group ("Spice level", "Extras") and its options, as the editor sends it. */
export type ModifierGroupInput = {
    id?: string
    name: string
    min_selections: number
    max_selections: number
    sort_order: number
    modifiers: {
        id?: string
        name: string
        price_adjustment: number
        is_available: boolean
        sort_order: number
    }[]
}

/**
 * Reconciles the stored add-on groups for one menu item against what the editor
 * submitted, in the same insert/update/delete shape the variation sync uses.
 *
 * The delete half is the fiddly part. order_item_modifiers.modifier_id is
 * ON DELETE RESTRICT, so an option that has ever been ordered cannot be
 * removed — and because a group cascades into its options, deleting such a
 * group fails outright. Anything with order history is therefore archived
 * instead of deleted; anything without is deleted for real, so correcting a
 * typo leaves nothing behind.
 *
 * Returns an error string only for failures worth surfacing — a partially
 * applied sync is reported rather than silently swallowed.
 */
async function syncModifierGroups(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    menuItemId: string,
    groups: ModifierGroupInput[]
): Promise<string | null> {
    const { data: existingGroups, error: fetchError } = await supabase
        .from('menu_item_modifier_groups')
        .select('id, menu_item_modifiers ( id )')
        .eq('menu_item_id', menuItemId)
        .eq('is_archived', false)

    if (fetchError) return fetchError.message

    const existing = (existingGroups || []) as { id: string; menu_item_modifiers: { id: string }[] | null }[]
    const incomingGroupIds = new Set(groups.filter(g => g.id).map(g => g.id!))

    // --- Removals -------------------------------------------------------
    const removedGroups = existing.filter(g => !incomingGroupIds.has(g.id))
    if (removedGroups.length > 0) {
        const removedModifierIds = removedGroups.flatMap(g => (g.menu_item_modifiers || []).map(m => m.id))
        const orderedIds = await modifierIdsWithOrderHistory(supabase, removedModifierIds)

        // A group is only safe to hard-delete when none of its options were ever
        // ordered; the cascade into menu_item_modifiers would otherwise trip the
        // RESTRICT and roll the whole delete back.
        const groupsToArchive = removedGroups.filter(g =>
            (g.menu_item_modifiers || []).some(m => orderedIds.has(m.id))
        )
        const groupsToDelete = removedGroups.filter(g => !groupsToArchive.includes(g))

        if (groupsToDelete.length > 0) {
            await supabase.from('menu_item_modifier_groups').delete().in('id', groupsToDelete.map(g => g.id))
        }
        if (groupsToArchive.length > 0) {
            await supabase
                .from('menu_item_modifier_groups')
                .update({ is_archived: true })
                .in('id', groupsToArchive.map(g => g.id))
        }
    }

    // --- Inserts & updates ----------------------------------------------
    for (const group of groups) {
        let groupId = group.id
        const groupRow = {
            menu_item_id: menuItemId,
            name: group.name.trim(),
            min_selections: group.min_selections,
            max_selections: group.max_selections,
            sort_order: group.sort_order,
        }

        if (groupId) {
            const { error } = await supabase.from('menu_item_modifier_groups').update(groupRow).eq('id', groupId)
            if (error) return error.message
        } else {
            const { data, error } = await supabase
                .from('menu_item_modifier_groups')
                .insert(groupRow)
                .select('id')
                .single()
            if (error) return error.message
            groupId = data.id
        }

        const optionError = await syncModifiers(supabase, groupId!, group.modifiers)
        if (optionError) return optionError
    }

    return null
}

/** The options inside one group — same hard-delete-or-archive rule as the group itself. */
async function syncModifiers(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    groupId: string,
    modifiers: ModifierGroupInput['modifiers']
): Promise<string | null> {
    const { data: existing, error: fetchError } = await supabase
        .from('menu_item_modifiers')
        .select('id')
        .eq('group_id', groupId)
        .eq('is_archived', false)

    if (fetchError) return fetchError.message

    const incomingIds = new Set(modifiers.filter(m => m.id).map(m => m.id!))
    const removedIds = (existing || []).map(m => m.id).filter(id => !incomingIds.has(id))

    if (removedIds.length > 0) {
        const orderedIds = await modifierIdsWithOrderHistory(supabase, removedIds)
        const toDelete = removedIds.filter(id => !orderedIds.has(id))
        const toArchive = removedIds.filter(id => orderedIds.has(id))

        if (toDelete.length > 0) {
            await supabase.from('menu_item_modifiers').delete().in('id', toDelete)
        }
        if (toArchive.length > 0) {
            // Archived *and* unavailable: the customer menu filters on
            // is_available, so this stays hidden even on a stale cache read.
            await supabase
                .from('menu_item_modifiers')
                .update({ is_archived: true, is_available: false })
                .in('id', toArchive)
        }
    }

    for (const mod of modifiers) {
        const row = {
            group_id: groupId,
            name: mod.name.trim(),
            price_adjustment: Number(mod.price_adjustment) || 0,
            is_available: mod.is_available,
            sort_order: mod.sort_order,
        }
        if (mod.id) {
            const { error } = await supabase.from('menu_item_modifiers').update(row).eq('id', mod.id)
            if (error) return error.message
        } else {
            const { error } = await supabase.from('menu_item_modifiers').insert(row)
            if (error) return error.message
        }
    }

    return null
}

/** Which of these option ids appear on a past order — i.e. cannot be deleted. */
async function modifierIdsWithOrderHistory(
    supabase: Awaited<ReturnType<typeof createAdminClient>>,
    modifierIds: string[]
): Promise<Set<string>> {
    if (modifierIds.length === 0) return new Set()
    const { data, error } = await supabase
        .from('order_item_modifiers')
        .select('modifier_id')
        .in('modifier_id', modifierIds)

    // On a read failure, assume every option has history: archiving something
    // that could have been deleted is recoverable, a failed delete is not.
    if (error) return new Set(modifierIds)
    return new Set((data || []).map(r => r.modifier_id as string))
}

/** Groups + options for the edit modal, archived rows excluded. */
export async function getItemModifiersAction(menuItemId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data, error } = await supabase
        .from('menu_item_modifier_groups')
        .select('id, name, min_selections, max_selections, sort_order, menu_item_modifiers ( id, name, price_adjustment, is_available, sort_order, is_archived )')
        .eq('menu_item_id', menuItemId)
        .eq('is_archived', false)
        .order('sort_order', { ascending: true })

    if (error) return { error: error.message }

    const groups = (data || []).map(g => ({
        id: g.id,
        name: g.name,
        min_selections: g.min_selections,
        max_selections: g.max_selections,
        sort_order: g.sort_order,
        modifiers: ((g.menu_item_modifiers || []) as { id: string; name: string; price_adjustment: number; is_available: boolean; sort_order: number; is_archived: boolean }[])
            .filter(m => !m.is_archived)
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(m => ({
                id: m.id,
                name: m.name,
                price_adjustment: Number(m.price_adjustment),
                is_available: m.is_available,
                sort_order: m.sort_order,
            })),
    }))

    return { data: groups }
}

export async function addItemAction(
    item: Record<string, unknown>,
    variations?: { name: string; price: number; is_available?: boolean; image_url?: string | null }[],
    recipe?: { ingredient_id: string; quantity_needed: number; variation_name?: string | null }[],
    modifierGroups?: ModifierGroupInput[]
) {
    await requireRole('manager', 'super_admin')
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

    // Best-effort rollback of the just-created item
    const rollbackItem = async () => {
        if (data.id) {
            await supabase.from('recipes').delete().eq('menu_item_id', data.id)
            await supabase.from('menu_item_variations').delete().eq('menu_item_id', data.id)
            await supabase.from('menu_items').delete().eq('id', data.id)
        }
    }

    // 1. If variations are provided, insert them first so we can map variation names to IDs
    let variationNameIdMap: Record<string, string> = {}
    if (variations && variations.length > 0) {
        const variationsToInsert = variations.map(v => ({
            menu_item_id: data.id,
            name: v.name,
            price: Number(v.price),
            is_available: v.is_available ?? true,
            image_url: v.image_url || null
        }))
        const { data: insertedVars, error: varError } = await supabase
            .from('menu_item_variations')
            .insert(variationsToInsert)
            .select('id, name')

        if (varError) {
            console.error('Failed to save variations:', varError)
            await rollbackItem()
            return { error: `Failed to save variations: ${varError.message}` }
        }

        insertedVars?.forEach(v => {
            variationNameIdMap[v.name.toLowerCase().trim()] = v.id
        })
    }

    // 2. If recipe is provided, insert it
    if (recipe && recipe.length > 0) {
        const recipesToInsert = recipe
            .map(r => {
                const varName = r.variation_name?.toLowerCase().trim()
                // varName set but unresolvable means the row references a variation that
                // was never created (client bug) — drop it rather than silently attaching
                // it to the whole item, which would over-deduct on every order.
                if (varName && !variationNameIdMap[varName]) return null
                const varId = varName ? variationNameIdMap[varName] : null
                return {
                    menu_item_id: varId ? null : data.id,
                    menu_item_variation_id: varId || null,
                    ingredient_id: r.ingredient_id,
                    quantity_needed: Number(r.quantity_needed)
                }
            })
            .filter((r): r is NonNullable<typeof r> => r !== null)
        const { error: recipeError } = await supabase
            .from('recipes')
            .insert(recipesToInsert)

        if (recipeError) {
            console.error('Failed to save recipe:', recipeError)
            await rollbackItem()
            return { error: `Failed to save recipe: ${recipeError.message}` }
        }
    }

    // 3. Add-on groups. Nothing here has order history yet, so the sync can only
    //    insert — but it still runs through the same path so the two save routes
    //    can never drift apart.
    if (modifierGroups && modifierGroups.length > 0) {
        const modifierError = await syncModifierGroups(supabase, data.id, modifierGroups)
        if (modifierError) {
            console.error('Failed to save add-ons:', modifierError)
            await rollbackItem()
            return { error: `Failed to save add-ons: ${modifierError}` }
        }
    }

    await invalidateCache(`menu-data:${restaurantId}`)
    revalidateTag(`menu-data-${restaurantId}`, 'max')
    revalidatePath('/admin/menu')
    return { data }
}

export async function updateItemAction(
    id: string,
    updates: Record<string, unknown>,
    variations?: { id?: string; name: string; price: number; is_available?: boolean; image_url?: string | null }[],
    recipe?: { ingredient_id: string; quantity_needed: number; variation_id?: string | null; variation_name?: string | null }[],
    modifierGroups?: ModifierGroupInput[]
) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: itemData } = await supabase
        .from('menu_items')
        .select('restaurant_id')
        .eq('id', id)
        .single()

    // Exclude variations from updates object if present
    const { variations: _, ...itemUpdates } = updates

    const { error } = await supabase
        .from('menu_items')
        .update(itemUpdates)
        .eq('id', id)

    if (error) return { error: error.message }

    let variationNameIdMap: Record<string, string> = {}

    // 1. Sync variations first
    if (variations) {
        const { data: existingVars } = await supabase
            .from('menu_item_variations')
            .select('id, name')
            .eq('menu_item_id', id)

        const existingIds = (existingVars || []).map(v => v.id)
        const incomingIds = variations.filter(v => v.id).map(v => v.id!)

        // Deletions
        const toDelete = existingIds.filter(eid => !incomingIds.includes(eid))
        if (toDelete.length > 0) {
            await supabase
                .from('menu_item_variations')
                .delete()
                .in('id', toDelete)
        }

        // Inserts
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
            const { data: insertedVars } = await supabase
                .from('menu_item_variations')
                .insert(toInsert)
                .select('id, name')

            insertedVars?.forEach(v => {
                variationNameIdMap[v.name.toLowerCase().trim()] = v.id
            })
        }

        // Updates
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

            if (v.id) {
                variationNameIdMap[v.name.toLowerCase().trim()] = v.id
                variationNameIdMap[v.id] = v.id
            }
        }
    }

    // 2. Sync recipes
    if (recipe) {
        // Fetch all current variations of this item
        const { data: currentVars } = await supabase
            .from('menu_item_variations')
            .select('id')
            .eq('menu_item_id', id)

        const varIds = (currentVars || []).map(v => v.id)

        // Snapshot existing recipes for potential rollback
        const selectQuery = supabase.from('recipes').select('ingredient_id, quantity_needed, menu_item_id, menu_item_variation_id')
        const deleteQuery = supabase.from('recipes').delete()

        if (varIds.length > 0) {
            selectQuery.or(`menu_item_id.eq.${id},menu_item_variation_id.in.(${varIds.join(',')})`)
            deleteQuery.or(`menu_item_id.eq.${id},menu_item_variation_id.in.(${varIds.join(',')})`)
        } else {
            selectQuery.eq('menu_item_id', id)
            deleteQuery.eq('menu_item_id', id)
        }

        const { data: prevRecipe } = await selectQuery
        await deleteQuery

        if (recipe.length > 0) {
            const recipesToInsert = recipe
                .map(r => {
                    const varRef = (r.variation_id || r.variation_name)?.toLowerCase().trim()
                    // varRef set but unresolvable means this row references a variation that
                    // no longer exists (e.g. deleted in this same edit) — drop it rather than
                    // silently attaching it to the whole item, which would over-deduct on
                    // every order regardless of which variation was ordered.
                    if (varRef && !variationNameIdMap[varRef]) return null
                    const varId = varRef ? variationNameIdMap[varRef] : null

                    return {
                        menu_item_id: varId ? null : id,
                        menu_item_variation_id: varId || null,
                        ingredient_id: r.ingredient_id,
                        quantity_needed: Number(r.quantity_needed)
                    }
                })
                .filter((r): r is NonNullable<typeof r> => r !== null)

            const { error: recipeError } = await supabase
                .from('recipes')
                .insert(recipesToInsert)

            if (recipeError) {
                console.error('Failed to save recipe:', recipeError)
                if (prevRecipe && prevRecipe.length > 0) {
                    await supabase.from('recipes').insert(
                        prevRecipe.map(r => ({
                            menu_item_id: r.menu_item_id,
                            menu_item_variation_id: r.menu_item_variation_id,
                            ingredient_id: r.ingredient_id,
                            quantity_needed: r.quantity_needed
                        }))
                    )
                }
                return { error: `Failed to save recipe: ${recipeError.message}` }
            }
        }
    }

    // 3. Sync add-on groups. Undefined means "the editor didn't send them"
    //    (a caller that only patches a field), which must not wipe them —
    //    an empty array is the explicit "remove them all".
    if (modifierGroups) {
        const modifierError = await syncModifierGroups(supabase, id, modifierGroups)
        if (modifierError) {
            console.error('Failed to save add-ons:', modifierError)
            return { error: `Failed to save add-ons: ${modifierError}` }
        }
    }

    if (itemData?.restaurant_id) {
        await invalidateCache(`menu-data:${itemData.restaurant_id}`)
        revalidateTag(`menu-data-${itemData.restaurant_id}`, 'max')
    }
    revalidatePath('/admin/menu')
    return { success: true }
}

export async function getItemRecipeAction(menuItemId: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: variations } = await supabase
        .from('menu_item_variations')
        .select('id')
        .eq('menu_item_id', menuItemId)

    const variationIds = (variations || []).map(v => v.id)

    const query = supabase
        .from('recipes')
        .select('ingredient_id, quantity_needed, menu_item_variation_id, ingredients(name, unit)')

    if (variationIds.length > 0) {
        query.or(`menu_item_id.eq.${menuItemId},menu_item_variation_id.in.(${variationIds.join(',')})`)
    } else {
        query.eq('menu_item_id', menuItemId)
    }

    const { data, error } = await query
    if (error) return { error: error.message }
    return { data: data || [] }
}

export async function deleteItemAction(id: string) {
    await requireRole('manager', 'super_admin')
    const supabase = await createAdminClient()

    const { data: itemData } = await supabase
        .from('menu_items')
        .select('restaurant_id')
        .eq('id', id)
        .single()

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

    if (itemData?.restaurant_id) {
        await invalidateCache(`menu-data:${itemData.restaurant_id}`)
        revalidateTag(`menu-data-${itemData.restaurant_id}`, 'max')
    }
    revalidatePath('/admin/menu')
    return { success: true }
}

