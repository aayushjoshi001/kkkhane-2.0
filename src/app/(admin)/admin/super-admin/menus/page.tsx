import { getAllMenusAcrossRestaurants } from '../actions'
import { UtensilsCrossed } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import MenuCatalogList from './MenuCatalogList'

export default async function MenusPage() {
    const { data } = await getAllMenusAcrossRestaurants()
    const groups = data || []

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader
                title="Menu Catalog"
                description="Read-only view of all restaurant menus across the platform."
                icon={<UtensilsCrossed size={18} />}
                color="orange"
            />

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{groups.length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Restaurants</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{groups.reduce((s, g) => s + g.totalItems, 0)}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Total Items</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{groups.reduce((s, g) => s + g.availableItems, 0)}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Available Items</div>
                </div>
            </div>

            <MenuCatalogList groups={groups as never} />
        </div>
    )
}
