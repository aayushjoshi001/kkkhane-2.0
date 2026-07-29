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

    // getCurrentUser() already carries the authenticated email. The previous
    // supabase.auth.getUser() call ran on the service-role admin client, which has
    // no user session, so it always returned null and left the email blank.
    const email = user.email

    // Automatically generate and retrieve hotel backup password for manager
    let backupPassword = ''
    if (dbUser.restaurant_id && (user.role === 'manager' || user.role === 'super_admin')) {
        const { data: restaurant } = await supabase
            .from('restaurants')
            .select('settings')
            .eq('id', dbUser.restaurant_id)
            .single()

        if (restaurant) {
            const settings = (restaurant.settings as any) || {}
            const featuresV2 = settings.features_v2 || {}
            let pwd = featuresV2.backup_password

            if (!pwd) {
                const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
                pwd = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

                const updatedSettings = {
                    ...settings,
                    features_v2: {
                        ...featuresV2,
                        backup_password: pwd
                    }
                }

                await supabase
                    .from('restaurants')
                    .update({ settings: updatedSettings })
                    .eq('id', dbUser.restaurant_id)
            }
            backupPassword = pwd
        }
    }

    return (
        <div className="space-y-6 pb-24 max-w-5xl mx-auto w-full">
            <PremiumPageHeader 
                title="My Profile" 
                description="Manage your personal information and preferences"
                icon={<UserCircle size={18} />}
                color="orange"
            />
            
            <div className="-mt-12 relative z-20 w-full">
                <ProfileForm user={dbUser} email={email} backupPassword={backupPassword} />
            </div>
        </div>
    )
}
