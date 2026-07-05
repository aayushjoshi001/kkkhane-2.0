'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { getOptionalUser } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Mirrors src/lib/actions/profile.ts's updateProfile, but uses getOptionalUser()
// since a user on the "Get Started" screen has no restaurant yet — getCurrentUser()
// would redirect/throw instead of returning a JSON error.
export async function updateOnboardingProfile(formData: FormData) {
    const user = await getOptionalUser()
    if (!user) {
        return { error: 'Not authenticated' }
    }

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
        console.error('Failed to update onboarding profile:', error)
        return { error: 'Failed to update profile' }
    }

    revalidatePath('/onboarding')

    return { success: true }
}
