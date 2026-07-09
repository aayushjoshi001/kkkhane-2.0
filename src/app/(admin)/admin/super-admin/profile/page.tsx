import { createAdminClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { UserCircle } from 'lucide-react'
import ProfileForm from '@/components/admin/ProfileForm'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Super admins render SuperAdminSidebar, whose footer links here — but this route
 * never existed, so the only way a super admin could reach their profile 404'd.
 * (Managers get AdminSidebar, which links to /admin/profile.) Same profile
 * surface, gated to super_admin, so both sidebars land on a real page.
 */
export default async function SuperAdminProfilePage() {
    const user = await requireRole('super_admin')
    const supabase = await createAdminClient()

    const { data: dbUser } = await supabase
        .from('users')
        .select('*, departments(*), roles(*)')
        .eq('id', user.id)
        .single()

    if (!dbUser) return notFound()

    // requireRole()/getCurrentUser() already carries the authenticated email —
    // supabase.auth.getUser() on the service-role client has no session.
    const email = user.email

    return (
        <div className="space-y-6 pb-24 max-w-5xl mx-auto w-full">
            <PremiumPageHeader
                title="My Profile"
                description="Manage your personal information and preferences"
                icon={<UserCircle size={18} />}
                color="purple"
            />

            <div className="-mt-12 relative z-20 w-full">
                <ProfileForm user={dbUser} email={email} />
            </div>
        </div>
    )
}
