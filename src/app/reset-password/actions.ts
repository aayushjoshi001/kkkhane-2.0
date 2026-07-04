'use server'

import { createServerClient } from '@/lib/supabase/server'

export async function resetPasswordAction(
    prevState: { error: string | null; success: boolean },
    formData: FormData
): Promise<{ error: string | null; success: boolean }> {
    const password = formData.get('password') as string | null
    const confirm = formData.get('confirm') as string | null

    if (!password || password.length < 8) {
        return { error: 'Password must be at least 8 characters.', success: false }
    }
    if (password !== confirm) {
        return { error: 'Passwords do not match.', success: false }
    }

    const supabase = await createServerClient()
    try {
        const { error } = await supabase.auth.updateUser({ password })

        if (error) {
            return { error: error.message, success: false }
        }
    } catch (e: any) {
        console.error('Reset password error:', e)
        if (e?.message?.includes('fetch failed') || e?.cause?.code) {
            return { error: 'Network error connecting to the server. Please try again later.', success: false }
        }
        return { error: 'An unexpected error occurred. Please try again.', success: false }
    }

    return { error: null, success: true }
}
