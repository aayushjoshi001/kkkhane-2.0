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

    // The backup password the manager quotes to /api/backup/export.
    //
    // This read `restaurants.settings` and wrote back to it, but restaurants has
    // no such column: PostgREST was resolving `select('settings')` as an embed of
    // the settings *table*, and the update named a column that does not exist.
    // Its error was never destructured, so every write failed in silence and a
    // freshly generated password was shown and thrown away on each visit. All
    // nine tenants had no backup_password stored, and the export answered 403 to
    // every one of them -- it fails closed, so nothing was exposed, but the
    // feature had never once worked. Read and write settings.features_v2, which
    // is where the export looks.
    let backupPassword = ''
    if (dbUser.restaurant_id && (user.role === 'manager' || user.role === 'super_admin')) {
        const { data: settingsRow } = await supabase
            .from('settings')
            .select('features_v2')
            .eq('restaurant_id', dbUser.restaurant_id)
            .maybeSingle()

        if (settingsRow) {
            const featuresV2 = (settingsRow.features_v2 as Record<string, unknown>) || {}
            let pwd = featuresV2.backup_password as string | undefined

            if (!pwd) {
                // randomBytes, not Math.random: this guards a full export of the
                // restaurant's orders, bookings and books, and Math.random is a
                // predictable PRNG whose output can be reconstructed from a few
                // samples. base64url of 9 bytes gives 12 URL-safe characters, the
                // same length as before but actually unguessable.
                const { randomBytes } = await import('crypto')
                pwd = randomBytes(9).toString('base64url')

                const { error: saveError } = await supabase
                    .from('settings')
                    .update({ features_v2: { ...featuresV2, backup_password: pwd } })
                    .eq('restaurant_id', dbUser.restaurant_id)

                // Surface a failure instead of handing over a password the export
                // will reject, which is exactly how this went unnoticed before.
                if (saveError) {
                    console.error('[profile] Failed to persist backup password:', saveError)
                    pwd = ''
                }
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
