import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { ShoppingBag } from 'lucide-react'
import { RowSkeleton } from '@/components/ui/Skeleton'

export default function Loading() {
    return (
        <div className="space-y-4 md:space-y-6">
            <PremiumPageHeader
                title="Order History"
                description="View and manage all orders. Managers can void or refund orders."
                icon={<ShoppingBag size={18} />}
                color="blue"
            />
            <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} />)}
            </div>
        </div>
    )
}
