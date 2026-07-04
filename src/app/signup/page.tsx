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
            
            <div className="flex-1 w-full relative z-10 flex flex-col bg-transparent md:bg-white rounded-t-[2rem] md:rounded-none -mt-6 md:mt-0 overflow-hidden">
                <div className="flex-1 w-full bg-white md:bg-transparent rounded-t-[2rem] md:rounded-none overflow-y-auto no-scrollbar relative">
                    <div className="min-h-full w-full flex flex-col px-6 sm:px-10 pt-4 pb-12">
                        <div className="w-full max-w-[500px] mx-auto my-auto flex flex-col items-center">
                            <SignupForm />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
