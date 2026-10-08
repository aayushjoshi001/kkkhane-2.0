import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import ProfileForm from '@/components/admin/ProfileForm'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { UserCircle } from 'lucide-react'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function BarProfilePage() {
    const user = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: dbUser } = await supabase
        .from('users')
        .select('*, departments(*), roles(*)')
        .eq('id', user.id)
        .single()

    if (!dbUser) return notFound()

    // getCurrentUser() already carries the authenticated email (the admin client
    // has no user session of its own). Same pattern as the kitchen profile page.
    const email = user.email

    return (
        <div className="space-y-6 max-w-2xl mx-auto mt-6 pb-24">
            <PremiumPageHeader title="My Profile" description="Update your name, password, and account details." icon={<UserCircle size={18} />} />
            <ProfileForm user={dbUser} email={email} />
        </div>
    )
}
