'use client'

import MenuItemCard from './MenuItemCard'
import type { MenuItem } from '@/types/database'

export default function MenuGrid({ items, sessionId, restaurantSlug, restaurantId, activeCategory }: {
    items: MenuItem[],
    sessionId?: string,
    restaurantSlug: string,
    restaurantId?: string,
    activeCategory: string,
}) {
    const filteredItems = items.filter((item) =>
        (activeCategory === 'all' || item.category_id === activeCategory)
    )

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-12">
            {filteredItems.map((item) => (
                <MenuItemCard
                    key={item.id}
                    item={item}
                    sessionId={sessionId}
                    restaurantSlug={restaurantSlug}
                    restaurantId={restaurantId}
                />
            ))}

            {filteredItems.length === 0 && (
                <div className="col-span-full text-center py-12 text-ink-subtle">
                    No items found in this category.
                </div>
            )}
        </div>
    )
}
