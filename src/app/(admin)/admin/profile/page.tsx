import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { UserCircle } from 'lucide-react'
import ProfileForm from '@/components/admin/ProfileForm'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function ProfilePage() {
    const user = await getCurrentUser()
    const supabase = await createAdminClient()

    // Fetch user details from `users` table
    const { data: dbUser } = await supabase
        .from('users')
        .select('*, departments(*), roles(*)')
        .eq('id', user.id)
        .single()

    if (!dbUser) return notFound()

    // Get auth user to retrieve email
    const { data: { user: authUser } } = await supabase.auth.getUser()
    const email = authUser?.email || ''

    return (
        <div className="space-y-6 pb-24 max-w-5xl mx-auto w-full">
            <PremiumPageHeader 
                title="My Profile" 
                description="Manage your personal information and preferences"
                icon={<UserCircle size={18} />}
                color="orange"
            />
            
            <div className="-mt-12 relative z-20 w-full">
                <ProfileForm user={dbUser} email={email} />
            </div>
        </div>
    )
}
