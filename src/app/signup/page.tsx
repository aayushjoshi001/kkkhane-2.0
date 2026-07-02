import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import SignupForm from './SignupForm'
import AuthHero from '@/components/shared/AuthHero'

export const metadata = {
    title: 'Create Your Restaurant — The House',
    description: 'Sign up and get your restaurant live in minutes.',
}

export default async function SignupPage() {
    const user = await getOptionalUser()
    if (user) redirect('/admin/dashboard')

    return (
        <div className="h-[100dvh] w-full flex flex-col md:flex-row bg-[#ff6b00] overflow-hidden">
            <div className="w-full md:w-[45%] lg:w-[40%] h-[35vh] md:h-full flex-shrink-0">
                <AuthHero heightClassName="h-full" />
            </div>
            <div className="flex-1 w-full flex flex-col justify-start items-center px-0 md:px-8 -mt-6 md:mt-0 relative z-10 bg-transparent md:bg-white rounded-t-[2rem] md:rounded-none overflow-hidden">
                <div className="w-full h-full bg-white md:bg-transparent px-6 sm:px-10 pt-4 pb-12 flex flex-col items-center overflow-y-auto no-scrollbar relative">
                    <SignupForm />
                </div>
            </div>
        </div>
    )
}
