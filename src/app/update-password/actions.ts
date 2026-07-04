'use server'

import { createServerClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function updatePasswordAction(prevState: { error: string | null }, formData: FormData) {
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (!password || !confirmPassword) {
        return { error: 'Both fields are required' }
    }

    if (password !== confirmPassword) {
        return { error: 'Passwords do not match' }
    }

    if (password.length < 8) {
        return { error: 'Password must be at least 8 characters' }
    }

    const supabase = await createServerClient()
    
    try {
        // Check if the user is authenticated
        const { data: { user }, error: userError } = await supabase.auth.getUser()
        
        if (userError || !user) {
            return { error: 'Session expired or invalid. Please request a new password reset link.' }
        }

        // Update the password
        const { error: updateError } = await supabase.auth.updateUser({
            password: password
        })

        if (updateError) {
            return { error: updateError.message }
        }

        // Redirect to login after successful password update
        await supabase.auth.signOut()
    } catch (e: any) {
        console.error('Update password error:', e)
        if (e?.message?.includes('fetch failed') || e?.cause?.code) {
            return { error: 'Network error connecting to the server. Please try again later.' }
        }
        return { error: 'An unexpected error occurred. Please try again.' }
    }
    redirect('/login?message=password_updated')
}
