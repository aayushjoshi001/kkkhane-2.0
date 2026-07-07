import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import OnboardingCreateClient from './OnboardingCreateClient'
import { Suspense } from 'react'

export default async function OnboardingCreatePage() {
    const currentUser = await getOptionalUser()

    if (!currentUser) {
        redirect('/login?redirect=/onboarding/create')
    }

    if (currentUser.restaurantId) {
        redirect('/admin/dashboard')
    }

    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="w-8 h-8 border-2 border-[#ff5a00] border-t-transparent rounded-full animate-spin" />
            </div>
        }>
            <OnboardingCreateClient />
        </Suspense>
    )
}
