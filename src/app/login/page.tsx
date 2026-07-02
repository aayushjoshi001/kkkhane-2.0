import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import { LoginForm } from './LoginForm'
import { ROLE_LANDING } from '@/lib/roleLanding'
import AuthHero from '@/components/shared/AuthHero'

export default async function LoginPage(props: { searchParams: Promise<{ redirect?: string }> }) {
    const searchParams = await props.searchParams
    // Empty (not defaulted to /admin/dashboard) so loginAction can tell "user was
    // bounced from a specific protected route" apart from "no redirect requested"
    // and fall back to the role-based landing page in the latter case.
    const redirectTo = searchParams.redirect || ''

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
            <div className="flex-1 w-full flex flex-col justify-start md:justify-center items-center px-0 md:px-8 -mt-6 md:mt-0 relative z-10 bg-transparent md:bg-white rounded-t-[2rem] md:rounded-none overflow-hidden">
                <div className="w-full h-full bg-white md:bg-transparent px-6 sm:px-10 pt-4 pb-12 flex flex-col items-center md:justify-center overflow-y-auto no-scrollbar">
                    <LoginForm redirectTo={redirectTo} />
                </div>
            </div>
        </div>
    )
}
