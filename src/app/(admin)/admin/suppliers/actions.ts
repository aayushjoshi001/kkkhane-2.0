'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

async function requireManager() {
    return requireRole('super_admin', 'manager')
}

const PATH = '/admin/suppliers'

export async function createSupplierAction(input: {
    name: string
    phone: string
    pan?: string
    vat?: string
    address?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const name = input.name?.trim()
    const phone = input.phone?.trim()
    if (!name) return { error: 'Supplier Name is required.' }
    if (!phone) return { error: 'Phone Number is required.' }

    const supabase = await createAdminClient()

    // Store PAN and VAT as a JSON string in contact_person
    const panVatJson = JSON.stringify({
        pan: input.pan?.trim() || '',
        vat: input.vat?.trim() || ''
    })

    const { data, error } = await supabase
        .from('suppliers')
        .insert({
            restaurant_id: user.restaurantId,
            name,
            phone,
            address: input.address?.trim() || null,
            contact_person: panVatJson, // Store PAN & VAT
            is_active: true,
            created_by: user.id
        })
        .select()
        .single()

    if (error) {
        if (error.code === '23505') {
            return { error: 'A supplier with this name already exists.' }
        }
        return { error: error.message }
    }

    revalidatePath(PATH)
    return { data }
}

export async function updateSupplierAction(id: string, input: {
    name: string
    phone: string
    pan?: string
    vat?: string
    address?: string
}) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const name = input.name?.trim()
    const phone = input.phone?.trim()
    if (!name) return { error: 'Supplier Name is required.' }
    if (!phone) return { error: 'Phone Number is required.' }

    const supabase = await createAdminClient()

    const panVatJson = JSON.stringify({
        pan: input.pan?.trim() || '',
        vat: input.vat?.trim() || ''
    })

    const { data, error } = await supabase
        .from('suppliers')
        .update({
            name,
            phone,
            address: input.address?.trim() || null,
            contact_person: panVatJson,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)
        .select()
        .single()

    if (error) return { error: error.message }

    revalidatePath(PATH)
    return { data }
}

export async function deleteSupplierAction(id: string) {
    let user
    try { user = await requireManager() } catch { return { error: 'Unauthorized' } }

    const supabase = await createAdminClient()

    const { error, count } = await supabase
        .from('suppliers')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('restaurant_id', user.restaurantId)

    if (error) return { error: error.message }
    if (!count) return { error: 'Supplier not found.' }

    revalidatePath(PATH)
    return { success: true }
}
