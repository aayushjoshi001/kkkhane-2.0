import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import { LoginForm } from './LoginForm'
import { ROLE_LANDING } from '@/lib/roleLanding'

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
        <div className="min-h-screen w-full flex items-center justify-center bg-canvas bg-[radial-gradient(circle,#E7E0D6_1.4px,transparent_1.4px)] bg-[size:26px_26px] overflow-auto p-4 sm:p-12">
            <LoginForm redirectTo={redirectTo} />
        </div>
    )
}
