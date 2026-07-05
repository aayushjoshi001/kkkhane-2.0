import { createAdminClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth'
import ProfileForm from '@/components/admin/ProfileForm'
import { UserCircle } from 'lucide-react'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function WaiterProfilePage() {
    const user = await getCurrentUser()
    const supabase = await createAdminClient()

    const { data: dbUser } = await supabase
        .from('users')
        .select('*, departments(*), roles(*)')
        .eq('id', user.id)
        .single()

    if (!dbUser) return notFound()

    const { data: { user: authUser } } = await supabase.auth.getUser()
    const email = authUser?.email || ''

    return (
        <div className="space-y-6 max-w-2xl mx-auto mt-6 pb-24">
            <div className="flex items-center gap-3 mb-6">
                <UserCircle className="text-brand-500" size={24} />
                <h1 className="text-2xl font-black text-ink">My Profile</h1>
            </div>
            
            <ProfileForm user={dbUser} email={email} />
        </div>
    )
}
