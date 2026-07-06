import { requireRole } from '@/lib/auth'
import { getAllIngredientsAcrossRestaurants } from '../actions'
import { Package, AlertTriangle } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

export default async function IngredientsPage() {
    await requireRole('super_admin')

    const result = await getAllIngredientsAcrossRestaurants()
    const ingredients = (result.data || []) as unknown as Array<{
        id: string
        restaurant_id: string
        name: string
        unit: string
        stock_quantity: number
        reorder_level: number | null
        restaurants: { name: string } | null
    }>

    const lowStock = ingredients.filter(i => i.reorder_level !== null && i.stock_quantity <= i.reorder_level)

    // Group by restaurant
    const grouped: Record<string, typeof ingredients> = {}
    for (const ing of ingredients) {
        const key = ing.restaurants?.name || ing.restaurant_id
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(ing)
    }

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Ingredients" 
                description="Cross-tenant ingredient inventory overview." 
                icon={<Package size={18} />}
                color="purple"
            />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{ingredients.length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Total Ingredients</div>
                </div>
                <div className={`rounded-xl border shadow-sm p-4 ${lowStock.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-surface border-hairline-strong'}`}>
                    <div className={`text-2xl font-extrabold ${lowStock.length > 0 ? 'text-amber-700' : 'text-ink'}`}>{lowStock.length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Low Stock Alerts</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{Object.keys(grouped).length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Restaurants Tracking</div>
                </div>
            </div>

            {lowStock.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-semibold text-amber-800">Low stock items</p>
                        <ul className="mt-1 space-y-0.5">
                            {lowStock.slice(0, 5).map(i => (
                                <li key={i.id} className="text-xs text-amber-700">
                                    <strong>{i.restaurants?.name}</strong> — {i.name}: {i.stock_quantity} {i.unit} (reorder at {i.reorder_level})
                                </li>
                            ))}
                            {lowStock.length > 5 && <li className="text-xs text-amber-600 font-medium">+{lowStock.length - 5} more</li>}
                        </ul>
                    </div>
                </div>
            )}

            {Object.entries(grouped).map(([restaurantName, items]) => {
                const restaurantLowStock = items.filter(i => i.reorder_level !== null && i.stock_quantity <= i.reorder_level)
                return (
                    <div key={restaurantName} className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        <div className="px-6 py-4 border-b border-hairline bg-surface-muted/50 flex items-center justify-between">
                            <h2 className="font-semibold text-ink">{restaurantName}</h2>
                            <span className="text-xs text-ink-subtle">
                                {items.length} items{restaurantLowStock.length > 0 ? ` · ` : ''}
                                {restaurantLowStock.length > 0 && <span className="text-amber-600 font-semibold">{restaurantLowStock.length} low stock</span>}
                            </span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                                    <tr>
                                        <th className="px-5 py-3 text-left">Ingredient</th>
                                        <th className="px-5 py-3 text-left">Unit</th>
                                        <th className="px-5 py-3 text-right">Stock</th>
                                        <th className="px-5 py-3 text-right">Reorder At</th>
                                        <th className="px-5 py-3 text-center">Alert</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {items.map(i => {
                                        const isLow = i.reorder_level !== null && i.stock_quantity <= i.reorder_level
                                        return (
                                            <tr key={i.id} className={`hover:bg-surface-muted/50 ${isLow ? 'bg-amber-50/30' : ''}`}>
                                                <td className="px-5 py-3 font-medium text-ink">{i.name}</td>
                                                <td className="px-5 py-3 text-ink-subtle">{i.unit}</td>
                                                <td className={`px-5 py-3 text-right font-semibold ${isLow ? 'text-amber-700' : 'text-ink'}`}>{i.stock_quantity}</td>
                                                <td className="px-5 py-3 text-right text-ink-subtle">{i.reorder_level ?? '—'}</td>
                                                <td className="px-5 py-3 text-center">
                                                    {isLow && <AlertTriangle size={13} className="text-amber-500 mx-auto" />}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })}

            {ingredients.length === 0 && (
                <div className="text-center py-16 text-ink-subtle">
                    <Package size={36} className="mx-auto mb-3 opacity-40" />
                    <p>No ingredients tracked yet</p>
                </div>
            )}
        </div>
    )
}
