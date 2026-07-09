'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Image from 'next/image'
import CategoryNav from './CategoryNav'
import MenuItemCard from './MenuItemCard'
import type { MenuCategory, MenuItem } from '@/types/database'
import { useTranslation } from '@/lib/contexts/TranslationContext'
import { Search, X } from 'lucide-react'

export default function MenuSection({
    categories,
    items,
    comboItems = [],
    sessionId,
    restaurantSlug,
    restaurantId,
    layout = 'grid',
    searchQuery = '',
    setSearchQuery = () => {},
}: {
    categories: MenuCategory[]
    items: MenuItem[]
    comboItems?: any[]
    sessionId?: string
    restaurantSlug: string
    restaurantId?: string
    layout?: 'grid' | 'list'
    searchQuery?: string
    setSearchQuery?: (val: string) => void
}) {
    const { t } = useTranslation()
    const [activeCategory, setActiveCategory] = useState('all')
    const observerRef = useRef<IntersectionObserver | null>(null)
    // Track whether a programmatic scroll is in progress to suppress spy updates
    const isScrollingRef = useRef(false)
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleCategoryChange = useCallback((id: string) => {
        setActiveCategory(id)
        // Suppress scroll-spy for 800ms while smooth-scroll plays out
        isScrollingRef.current = true
        if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
        scrollTimerRef.current = setTimeout(() => {
            isScrollingRef.current = false
        }, 800)
    }, [])

    // Build list of sections to observe: one per category + 'all' sentinel at top
    useEffect(() => {
        if (observerRef.current) observerRef.current.disconnect()

        // Sticky header (148px) + search bar overlap (18px) + category nav (36px) = ~202px
        const SCROLL_OFFSET = 202

        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (isScrollingRef.current) return
                // Pick the topmost visible section
                const visible = entries
                .filter(e => e.isIntersecting)
                .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
                if (visible.length > 0) {
                    const id = visible[0].target.getAttribute('data-category-id')
                    if (id) setActiveCategory(id)
                }
            },
            {
                rootMargin: `-${SCROLL_OFFSET}px 0px -40% 0px`,
                threshold: 0,
            }
        )

        categories.forEach(c => {
            const el = document.getElementById(`category-section-${c.id}`)
            if (el) observerRef.current!.observe(el)
        })
        // Also observe the "all" sentinel at the very top
        const allEl = document.getElementById('category-section-all')
        if (allEl) observerRef.current!.observe(allEl)

        return () => observerRef.current?.disconnect()
    }, [categories, searchQuery]) // Re-run when categories or search changes

    // Filter items based on search query
    const filteredItems = useMemo(() => {
        if (!searchQuery.trim()) return items
        const query = searchQuery.toLowerCase()
        return items.filter(item => 
            item.name.toLowerCase().includes(query) || 
            (item.description && item.description.toLowerCase().includes(query))
        )
    }, [items, searchQuery])

    // Items grouped by category in display order
    const categoriesWithItems = categories
        .map(c => ({
            category: c,
            items: filteredItems.filter(item => item.category_id === c.id),
        }))
        .filter(g => g.items.length > 0)

    const uncategorised = filteredItems.filter(item => !item.category_id || !categories.find(c => c.id === item.category_id))

    return (
        <>

            {!searchQuery && (
                <CategoryNav
                    categories={categories}
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                />
            )}

            <div className="pt-1 pb-12 space-y-8">
                {/* "All" sentinel — invisible element for scroll-spy when scrolled to very top */}
                <div id="category-section-all" data-category-id="all" className="h-0" />

                {uncategorised.length > 0 && (
                    <section>
                        <ItemGrid
                            items={uncategorised}
                            comboItems={comboItems}
                            menuItems={items}
                            sessionId={sessionId}
                            restaurantSlug={restaurantSlug}
                            restaurantId={restaurantId}
                            layout={layout}
                        />
                    </section>
                )}

                {categoriesWithItems.map(({ category, items: catItems }) => (
                    <section
                        key={category.id}
                        id={`category-section-${category.id}`}
                        data-category-id={category.id}
                    >
                        {/* Category heading */}
                        <div className="flex items-center gap-3 mb-4">
                            {category.image_url && (
                                <Image
                                    src={category.image_url}
                                    alt=""
                                    width={32}
                                    height={32}
                                    className="w-8 h-8 rounded-lg object-cover shrink-0 border border-hairline"
                                />
                            )}
                            <h2 className="text-base font-bold text-ink leading-none">
                                {t('category_name', category.id, category.name)}
                            </h2>
                            <span className="text-xs text-ink-subtle font-medium">{catItems.length} items</span>
                            <div className="flex-1 h-px bg-surface-muted" />
                        </div>

                        <ItemGrid
                            items={catItems}
                            comboItems={comboItems}
                            menuItems={items}
                            sessionId={sessionId}
                            restaurantSlug={restaurantSlug}
                            restaurantId={restaurantId}
                            layout={layout}
                        />
                    </section>
                ))}

                {categoriesWithItems.length === 0 && uncategorised.length === 0 && (
                    <div className="py-16 text-center text-ink-subtle text-sm">
                        No menu items available.
                    </div>
                )}
            </div>
        </>
    )
}

function ItemGrid({ items, comboItems, menuItems, sessionId, restaurantSlug, restaurantId, layout = 'grid' }: {
    items: MenuItem[]
    comboItems: any[]
    menuItems: MenuItem[]
    sessionId?: string
    restaurantSlug: string
    restaurantId?: string
    layout?: 'grid' | 'list'
}) {
    const containerCls = layout === 'list'
        ? 'flex flex-col gap-3'
        : 'flex overflow-x-auto gap-4 pb-6 scrollbar-none snap-x snap-mandatory -mx-4 px-6 scroll-pl-6 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-6 sm:mx-0 sm:px-0'

    return (
        <div className={containerCls} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {items.map((item) => (
                <div
                    key={item.id}
                    className={layout === 'list'
                        ? 'w-full'
                        : 'w-[165px] sm:w-auto shrink-0 snap-start h-full'
                    }
                >
                    <MenuItemCard
                        item={item}
                        comboItems={comboItems}
                        menuItems={menuItems}
                        sessionId={sessionId}
                        restaurantSlug={restaurantSlug}
                        restaurantId={restaurantId}
                    />
                </div>
            ))}
        </div>
    )
}
