'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Logo from '@/components/shared/Logo'
import TakeoutForm from '@/components/customer/TakeoutForm'
import ActiveOrderPill from '@/components/customer/ActiveOrderPill'
import { useCartStore } from '@/lib/stores/cart'
import { ShoppingBag, UserCircle, Search, X, UtensilsCrossed } from 'lucide-react'
import { TranslationProvider, useTranslation } from '@/lib/contexts/TranslationContext'
import { FeatureProvider, useCurrency } from '@/lib/contexts/FeatureContext'
import type { Settings, MenuItem } from '@/types/database'
import LanguageSwitcher from '@/components/customer/LanguageSwitcher'
import MenuItemCard from '@/components/customer/MenuItemCard'
import CustomerProfileSheet from '@/components/customer/CustomerProfileSheet'

interface Category { id: string; name: string; sort_order: number }
interface Restaurant { id: string; name: string; slug: string; description: string | null; logo_url: string | null }
interface TranslationRow { language_code: string; entity_type: string; entity_id: string; translated_text: string }

interface Props {
    restaurant: Restaurant
    categories: Category[]
    menuItems: MenuItem[]
    comboItems: any[]
    translations: TranslationRow[]
    supportedLanguages: { code: string; name: string }[]
    features: Settings['features_v2'] | null
}

const PROMOS = [
    { id: 1, text: "🔥 Flat 10% off on all items! Use code: FLAT10", bg: "from-orange-500 to-amber-500", textCol: "text-white" },
    { id: 2, text: "🎉 Free drink on orders above Rs. 1,000!", bg: "from-red-500 to-rose-500", textCol: "text-white" },
    { id: 3, text: "✨ Happy hour combo deals live now!", bg: "from-indigo-600 to-purple-600", textCol: "text-white" }
]

function PromoBanner() {
    const [current, setCurrent] = useState(0)
    useEffect(() => {
        const timer = setInterval(() => {
            setCurrent(c => (c + 1) % PROMOS.length)
        }, 4000)
        return () => clearInterval(timer)
    }, [])

    return (
        <div className="h-16 relative w-full overflow-hidden flex items-center justify-center">
            {PROMOS.map((p, idx) => (
                <div
                    key={p.id}
                    className={`absolute inset-0 flex flex-col items-center justify-center px-6 text-center transition-all duration-700 ${
                        idx === current
                            ? 'opacity-100 translate-y-0 scale-100'
                            : 'opacity-0 -translate-y-4 scale-95 pointer-events-none'
                    }`}
                >
                    <span className="text-[10px] text-orange-300 uppercase tracking-widest font-black mb-1 drop-shadow-sm">Featured Offer</span>
                    <p className="text-white text-xs font-black drop-shadow-md leading-snug max-w-[280px] uppercase tracking-wide">
                        {p.text}
                    </p>
                </div>
            ))}
        </div>
    )
}

export default function TakeoutPageClient({ restaurant, categories, menuItems, comboItems, translations, supportedLanguages, features }: Props) {
    return (
        <FeatureProvider features={features}>
            <TranslationProvider translations={translations} supportedLanguages={supportedLanguages} restaurantId={restaurant.id}>
                <TakeoutMenu restaurant={restaurant} categories={categories} menuItems={menuItems} comboItems={comboItems} />
            </TranslationProvider>
        </FeatureProvider>
    )
}

function TakeoutMenu({ restaurant, categories, menuItems, comboItems }: {
    restaurant: Restaurant; categories: Category[]; menuItems: MenuItem[]; comboItems: any[]
}) {
    const { t } = useTranslation()
    const money = useCurrency()
    const [activeCategory, setActiveCategory] = useState(categories[0]?.id || '')
    const [showCheckout, setShowCheckout] = useState(false)
    const [showProfile, setShowProfile] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const items = useCartStore(s => s.items)
    const totalAmount = useCartStore(s => s.totalAmount)

    const filteredItems = (activeCategory ? menuItems.filter(i => i.category_id === activeCategory) : menuItems)
        .filter(i => !searchQuery || i.name.toLowerCase().includes(searchQuery.toLowerCase()))

    if (showCheckout) {
        return (
            <div className="min-h-screen bg-surface-muted">
                <div className="max-w-lg mx-auto px-4 py-8">
                    <button onClick={() => setShowCheckout(false)}
                        className="text-sm text-ink-subtle mb-4 hover:text-ink">← Back to menu</button>
                    <TakeoutForm restaurantId={restaurant.id} restaurantName={restaurant.name} restaurantSlug={restaurant.slug} />
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-surface-muted">
            <ActiveOrderPill />
            {/* Sticky header — branded and curved bottom matching Dine-in wireframe */}
            <header className="relative bg-brand-500 text-white rounded-b-[36px] sticky top-0 z-40 pb-6 pt-2 shadow-md flex flex-col gap-2">
                <div className="absolute inset-x-0 bottom-0 top-[48px] rounded-b-[36px] overflow-hidden z-0">
                    <div 
                        className="absolute inset-0 bg-cover bg-center filter brightness-[0.55] scale-105"
                        style={{ backgroundImage: `url('https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=600&auto=format&fit=crop')` }}
                    />
                    <div className="absolute inset-0 bg-brand-500/15 mix-blend-multiply" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/20 to-black/60" />
                </div>

                <div className="max-w-2xl mx-auto w-full px-4 flex items-center justify-between gap-3 h-10 relative z-10">
                    <div className="flex items-center gap-2 shrink-0">
                        {restaurant.logo_url ? (
                            <div className="relative w-8 h-8 rounded-full overflow-hidden bg-surface shrink-0 border border-white/25 shadow-sm">
                                <Image src={restaurant.logo_url} alt={restaurant.name} fill className="object-cover" sizes="32px" />
                            </div>
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-surface/10 flex items-center justify-center shrink-0 border border-white/25 shadow-sm">
                                <UtensilsCrossed size={14} className="text-white" />
                            </div>
                        )}
                        <div className="flex flex-col">
                            <span className="text-[8px] text-white/70 uppercase font-black tracking-wide leading-none">Takeout</span>
                            <span className="text-xs font-black tracking-tight truncate max-w-[120px] leading-tight">
                                {restaurant.name}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 pr-1">
                        <LanguageSwitcher />
                        <button 
                            onClick={() => setShowProfile(true)}
                            className="w-8 h-8 rounded-full bg-surface/10 hover:bg-surface/20 flex items-center justify-center shrink-0 border border-white/25 shadow-sm transition-colors"
                        >
                            <UserCircle size={18} className="text-white" />
                        </button>
                        <div className="w-8 h-8 rounded-full bg-surface flex items-center justify-center shrink-0 border-2 border-white overflow-hidden relative shadow-sm">
                            <Image src="/brand/kkkhane-k-logo.jpg" alt="kkkhane" fill className="object-cover scale-[1.45]" sizes="32px" />
                        </div>
                    </div>
                </div>
                
                <div className="w-full text-center pb-1 relative z-10">
                    <PromoBanner />
                </div>

                <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2 w-[85%] max-w-md z-30">
                    <div className="relative shadow-md rounded-full overflow-hidden">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                            <Search className="h-3.5 w-3.5 text-brand-500" />
                        </div>
                        <input
                            type="text"
                            placeholder="SEARCH FOR ITEM..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="block w-full pl-10 pr-10 py-2.5 text-[11px] border-0 rounded-full bg-brand-50 text-brand-900 placeholder-[#D68E65] font-extrabold focus:outline-none focus:ring-2 focus:ring-orange-300 focus:bg-surface transition-all text-center uppercase tracking-wider"
                        />
                        {searchQuery && (
                            <button
                                onClick={() => setSearchQuery('')}
                                className="absolute inset-y-0 right-0 pr-4 flex items-center text-brand-500 hover:text-orange-700"
                            >
                                <X className="h-4 w-4 stroke-[3px]" />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <CustomerProfileSheet 
                isOpen={showProfile} 
                onClose={() => setShowProfile(false)} 
                restaurantId={restaurant.id}
            />

            {/* Category Tabs */}
            <div className="bg-surface border-b border-hairline sticky top-[73px] z-10">
                <div className="max-w-4xl mx-auto px-4 flex gap-1 overflow-x-auto py-2">
                    {categories.map(c => (
                        <button key={c.id}
                            onClick={() => setActiveCategory(c.id)}
                            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap font-medium transition ${activeCategory === c.id
                                ? 'bg-ink text-white'
                                : 'bg-surface-muted text-ink-muted hover:bg-surface-muted'}`}>
                            {t('category_name', c.id, c.name)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Menu Grid */}
            <div className="max-w-4xl mx-auto px-4 py-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredItems.map(item => (
                        <MenuItemCard
                            key={item.id}
                            item={item}
                            comboItems={comboItems}
                            menuItems={menuItems}
                            restaurantSlug={restaurant.slug}
                            restaurantId={restaurant.id}
                            isTakeout={true}
                        />
                    ))}
                </div>
            </div>

            {/* Floating Cart Bar */}
            {items.length > 0 && (
                <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-hairline-strong p-4 md:hidden z-20">
                    <button onClick={() => setShowCheckout(true)}
                        className="w-full bg-ink text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                        <ShoppingBag size={18} />
                        Checkout ({items.reduce((s, i) => s + i.quantity, 0)} items) — {money(totalAmount())}
                    </button>
                </div>
            )}
        </div>
    )
}
