'use client'
 
import { useRef, useEffect } from 'react'
import Image from 'next/image'
import type { MenuCategory } from '@/types/database'
import { useTranslation } from '@/lib/contexts/TranslationContext'
 
export default function CategoryNav({
    categories,
    activeCategory,
    onCategoryChange,
}: {
    categories: MenuCategory[]
    activeCategory: string
    onCategoryChange: (id: string) => void
}) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
    const { t } = useTranslation()
 
    useEffect(() => {
        const btn = btnRefs.current[activeCategory]
        const container = scrollRef.current
        if (btn && container) {
            const containerWidth = container.offsetWidth
            const btnWidth = btn.offsetWidth
            const btnLeft = btn.offsetLeft
            // Center the active category button horizontally in the scrollable container
            const targetScrollLeft = btnLeft - (containerWidth / 2) + (btnWidth / 2)
            container.scrollTo({ left: targetScrollLeft, behavior: 'smooth' })
        }
    }, [activeCategory])
 
    const handleClick = (id: string) => {
        onCategoryChange(id)
        const target = document.getElementById(`category-section-${id}`)
        if (target) {
            // Header height (148px) + search bar overlap (18px) + CategoryNav height (~36px) = ~202px
            const top = target.getBoundingClientRect().top + window.scrollY - 202
            window.scrollTo({ top, behavior: 'smooth' })
        }
    }
 
    return (
        <div className="bg-surface-muted sticky top-[112px] z-30 shadow-sm -mx-4 mt-[-36px] pt-[66px] pb-1 px-0">
            <div
                ref={scrollRef}
                className="flex overflow-x-auto gap-1 px-4"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
                {['all', ...categories.map(c => c.id)].map((id, idx) => {
                    const cat = categories.find(c => c.id === id)
                    const label = id === 'all' ? 'All' : t('category_name', id, cat?.name || id)
                    const isActive = activeCategory === id
                    return (
                        <button
                            key={id}
                            ref={el => { btnRefs.current[id] = el }}
                            onClick={() => handleClick(id)}
                            className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full text-[11px] font-black transition-all duration-200 shrink-0 uppercase tracking-wider ${
                                cat?.image_url ? 'pl-0.5 pr-2.5 py-0.5' : 'px-3 py-1'
                            } ${
                                isActive
                                    ? 'bg-[var(--color-primary)] text-white shadow-sm shadow-[var(--color-primary)]/20'
                                    : 'text-ink-subtle hover:text-ink hover:bg-surface-muted/50 active:scale-95'
                            }`}
                        >
                            {cat?.image_url ? (
                                <Image src={cat.image_url} alt={cat.name} width={18} height={18} className="w-4.5 h-4.5 rounded-full object-cover shrink-0" />
                            ) : cat?.emoji ? (
                                <span className="text-[10px]">{cat.emoji}</span>
                            ) : null}
                            {label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
