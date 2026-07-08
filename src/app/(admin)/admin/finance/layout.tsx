import { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getRestaurantFeatures } from '@/lib/features'
import { FinanceUnderDevelopment } from '@/components/finance'

export default async function FinanceLayout({ children }: { children: ReactNode }) {
    const currentUser = await getCurrentUser()
    
    // Check if user has access to finance (super_admin bypasses check, manager checked via feature flag)
    if (currentUser.role !== 'super_admin') {
        const features = await getRestaurantFeatures(currentUser.restaurantId)
        if (!features?.financeEnabled) {
            redirect('/admin/dashboard')
        }
    }

    return (
        <div className="space-y-5">
            <div className="bg-surface p-5 md:p-6 rounded-[var(--radius-card)] border border-hairline shadow-sm space-y-4">
                <div>
                    <h1 className="text-2xl font-black text-ink">Finance</h1>
                    <p className="text-ink-subtle text-sm mt-1">
                        Structure preview — automatic posting, cross-module sync, and calculations arrive in a later phase.
                    </p>
                </div>
            </div>
            <FinanceUnderDevelopment />
        </div>
    )
}
