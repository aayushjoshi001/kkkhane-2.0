import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import OnboardingGetStarted from './OnboardingGetStarted'
import { createAdminClient } from '@/lib/supabase/server'

export default async function OnboardingPage() {
    const currentUser = await getOptionalUser()

    if (!currentUser) {
        redirect('/login?redirect=/onboarding')
    }

    // Platform super admin owns no restaurant and never onboards — send it to the
    // super-admin console instead of showing the create-restaurant flow.
    if (currentUser.role === 'super_admin') {
        redirect('/admin/super-admin/dashboard')
    }

    // If they already have a restaurant, they shouldn't be here
    if (currentUser.restaurantId) {
        redirect('/admin/dashboard')
    }

    // Fetch full name + avatar from users table
    const adminSupabase = await createAdminClient()
    const { data: userData } = await adminSupabase
        .from('users')
        .select('full_name, avatar_url')
        .eq('id', currentUser.id)
        .single()

    const userName = userData?.full_name || currentUser.email.split('@')[0] || 'User'

    return (
        <OnboardingGetStarted
            userId={currentUser.id}
            userEmail={currentUser.email}
            userName={userName}
            userAvatarUrl={userData?.avatar_url}
        />
    )
}
