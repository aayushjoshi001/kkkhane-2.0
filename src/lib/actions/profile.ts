'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function updateProfile(formData: FormData) {
    try {
        const user = await getCurrentUser()
        const fullName = formData.get('full_name') as string
        const avatarUrl = formData.get('avatar_url') as string
        
        if (!fullName || fullName.trim().length === 0) {
            return { error: 'Full name is required' }
        }

        const supabase = await createAdminClient()

        const { error } = await supabase
            .from('users')
            .update({
                full_name: fullName.trim(),
                avatar_url: avatarUrl || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', user.id)

        if (error) {
            console.error('Failed to update profile:', error)
            return { error: 'Failed to update profile' }
        }

        revalidatePath('/admin/profile')
        revalidatePath('/', 'layout')
        
        return { success: true }
    } catch (e) {
        console.error('Profile update error:', e)
        return { error: 'An unexpected error occurred' }
    }
}
