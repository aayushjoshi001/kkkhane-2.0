import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import { ROLE_LANDING } from '@/lib/roleLanding'
import AuthHero from '@/components/shared/AuthHero'
import LoginScreen from './LoginScreen'

export default async function LoginPage(props: { searchParams: Promise<{ redirect?: string; r?: string }> }) {
    const searchParams = await props.searchParams
    // Empty (not defaulted to /admin/dashboard) so loginAction can tell "user was
    // bounced from a specific protected route" apart from "no redirect requested"
    // and fall back to the role-based landing page in the latter case.
    const redirectTo = searchParams.redirect || ''
    // Present when a shared POS device is bookmarked to `/login?r=<restaurant-slug>` —
    // routes straight to the staff name+PIN terminal instead of the owner form.
    const staffTerminalSlug = searchParams.r || ''

    // If already logged in, redirect to appropriate dashboard
    const currentUser = await getOptionalUser()
    if (currentUser) {
        const landing = ROLE_LANDING[currentUser.role] || '/admin/dashboard'
        redirect(landing)
    }

    return (
        <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#ff6b00] overflow-hidden">
            <div className="w-full md:w-[45%] lg:w-[40%] h-[35vh] md:h-full flex-shrink-0">
                <AuthHero heightClassName="h-full" />
            </div>
            
            <div className="flex-1 w-full relative z-10 flex flex-col bg-transparent md:bg-white rounded-t-[2rem] md:rounded-none -mt-6 md:mt-0 overflow-hidden">
                <div className="flex-1 w-full bg-white md:bg-transparent rounded-t-[2rem] md:rounded-none overflow-y-auto no-scrollbar">
                    <div className="min-h-full w-full flex flex-col px-6 sm:px-10 pt-4 pb-12">
                        <div className="w-full max-w-[420px] mx-auto my-auto flex flex-col">
                            <LoginScreen redirectTo={redirectTo} initialSlug={staffTerminalSlug} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
