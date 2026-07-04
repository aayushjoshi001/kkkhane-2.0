'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function createDepartmentAction(name: string, description: string | null) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'Unauthorized' }
    }

    const { data, error } = await supabase
        .from('departments')
        .insert({
            restaurant_id: currentUser.restaurantId,
            name: name.trim(),
            description: description?.trim() || null
        })
        .select()
        .single()

    if (error) return { error: error.message }
    
    revalidatePath('/admin/staff')
    return { success: true, department: data }
}

export async function updateDepartmentAction(id: string, name: string, description: string | null) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'Unauthorized' }
    }

    const { data: dept } = await supabase.from('departments').select('restaurant_id').eq('id', id).single()
    if (dept?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const { error } = await supabase
        .from('departments')
        .update({
            name: name.trim(),
            description: description?.trim() || null
        })
        .eq('id', id)

    if (error) return { error: error.message }
    
    revalidatePath('/admin/staff')
    return { success: true }
}

export async function deleteDepartmentAction(id: string) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'Unauthorized' }
    }

    const { data: dept } = await supabase.from('departments').select('restaurant_id').eq('id', id).single()
    if (dept?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const { error } = await supabase.from('departments').delete().eq('id', id)
    if (error) return { error: error.message }
    
    revalidatePath('/admin/staff')
    return { success: true }
}

export async function updateStaffDepartmentAction(userId: string, departmentId: string | null) {
    const currentUser = await getCurrentUser()
    const supabase = await createAdminClient()

    if (!['manager', 'super_admin'].includes(currentUser.role)) {
        return { error: 'Unauthorized' }
    }

    const { data: targetUser } = await supabase.from('users').select('restaurant_id').eq('id', userId).single()
    if (targetUser?.restaurant_id !== currentUser.restaurantId) return { error: 'Unauthorized' }

    const { error } = await supabase.from('users').update({ department_id: departmentId }).eq('id', userId)
    if (error) return { error: error.message }
    
    revalidatePath('/admin/staff')
    return { success: true }
}
