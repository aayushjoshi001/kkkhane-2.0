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
        .select('*')
        .eq('id', user.id)
        .single()

    if (!dbUser) return notFound()

    return (
        <div className="space-y-6">
            <PremiumPageHeader 
                title="My Profile" 
                description="Manage your personal information and preferences"
                icon={<UserCircle size={18} />}
                color="orange"
            />
            
            <div className="max-w-2xl">
                <ProfileForm user={dbUser} />
            </div>
        </div>
    )
}
