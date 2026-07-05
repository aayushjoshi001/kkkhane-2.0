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
}: {
    categories: MenuCategory[]
    items: MenuItem[]
    comboItems?: any[]
    sessionId?: string
    restaurantSlug: string
    restaurantId?: string
    layout?: 'grid' | 'list'
}) {
    const { t } = useTranslation()
    const [activeCategory, setActiveCategory] = useState('all')
    const [searchQuery, setSearchQuery] = useState('')
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

        // Sticky header (56px) + banner (40px) + search (52px) + category nav (44px) = ~192px
        const SCROLL_OFFSET = 200

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
            <div className="sticky top-[96px] z-40 bg-gray-50 pb-2 px-4 md:px-0">
                <div className="relative max-w-3xl mx-auto mt-2">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        placeholder="Search menu items..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="block w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl leading-5 bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary sm:text-sm transition-all"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </div>

            {!searchQuery && (
                <CategoryNav
                    categories={categories}
                    activeCategory={activeCategory}
                    onCategoryChange={handleCategoryChange}
                />
            )}

            <div className="pt-4 pb-12 space-y-8">
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
                                    className="w-8 h-8 rounded-lg object-cover shrink-0 border border-gray-100"
                                />
                            )}
                            <h2 className="text-base font-bold text-gray-900 leading-none">
                                {t('category_name', category.id, category.name)}
                            </h2>
                            <span className="text-xs text-gray-400 font-medium">{catItems.length} items</span>
                            <div className="flex-1 h-px bg-gray-100" />
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
                    <div className="py-16 text-center text-gray-400 text-sm">
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
    // If layout is 'list', use simple vertical flex.
    // Otherwise on mobile: flex row horizontal scroll; on desktop: regular grid.
    const containerCls = layout === 'list'
        ? 'flex flex-col gap-3'
        : 'flex overflow-x-auto gap-3 pb-4 scrollbar-none snap-x snap-mandatory sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4 -mx-4 px-4 sm:mx-0 sm:px-0'

    return (
        <div className={containerCls} style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {items.map((item) => (
                <div
                    key={item.id}
                    className={layout === 'list'
                        ? 'w-full'
                        : 'w-[calc((100vw-32px-12px)/2.25)] sm:w-auto shrink-0 snap-start h-full'
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
