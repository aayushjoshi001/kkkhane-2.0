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
        btn?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
    }, [activeCategory])

    const handleClick = (id: string) => {
        onCategoryChange(id)
        const target = document.getElementById(`category-section-${id}`)
        if (target) {
            const top = target.getBoundingClientRect().top + window.scrollY - 192
            window.scrollTo({ top, behavior: 'smooth' })
        }
    }

    return (
        <div className="bg-white border-b border-gray-100 sticky top-[148px] z-30">
            <div
                ref={scrollRef}
                className="flex overflow-x-auto gap-1.5 px-4 py-2.5"
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
                            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full text-[13px] font-medium transition-all duration-200 shrink-0 ${
                                cat?.image_url ? 'pl-1 pr-4 py-1' : 'px-4 py-1.5'
                            } ${
                                isActive
                                    ? 'bg-[var(--color-primary)] text-white shadow-sm shadow-[var(--color-primary)]/30'
                                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100 active:scale-95'
                            }`}
                        >
                            {cat?.image_url ? (
                                <Image src={cat.image_url} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover shrink-0" />
                            ) : cat?.emoji ? (
                                <span>{cat.emoji}</span>
                            ) : null}
                            {label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
