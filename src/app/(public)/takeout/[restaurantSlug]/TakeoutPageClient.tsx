'use client'

import { useState, useEffect } from 'react'
import TakeoutForm from '@/components/customer/TakeoutForm'
import ActiveOrderPill from '@/components/customer/ActiveOrderPill'
import { useCartStore } from '@/lib/stores/cart'
import { ShoppingBag } from 'lucide-react'
import { TranslationProvider, useTranslation } from '@/lib/contexts/TranslationContext'
import { FeatureProvider, useCurrency } from '@/lib/contexts/FeatureContext'
import type { Settings, MenuItem } from '@/types/database'
import MenuItemCard from '@/components/customer/MenuItemCard'
import CustomerProfileSheet from '@/components/customer/CustomerProfileSheet'
import CustomerMenuHeader from '@/components/customer/CustomerMenuHeader'

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
    const setSession = useCartStore(s => s.setSession)
    const clearCart = useCartStore(s => s.clearCart)

    // Scope the cart to THIS restaurant's takeout. The cart store is shared with
    // dine-in and other restaurants; setSession clears it when the scope key
    // changes (so a leftover dine-in cart can't bleed into a staff takeaway) and
    // preserves it when re-entering the same takeout page.
    useEffect(() => {
        setSession(`takeout:${restaurant.id}`, restaurant.slug, restaurant.id)
    }, [restaurant.id, restaurant.slug, setSession])

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
            <CustomerMenuHeader
                logoUrl={restaurant.logo_url}
                restaurantName={restaurant.name}
                eyebrow="Takeout"
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onProfileClick={() => setShowProfile(true)}
                showLanguageSwitcher
            />

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
                            layout="list"
                        />
                    ))}
                </div>
            </div>

            {/* Floating Cart Bar — shown on every breakpoint. It used to be
                md:hidden, which left desktop/tablet users (staff opening
                "Manual Takeaway/Delivery", plus any desktop customer) with no way
                to open the cart and place the order after adding items. On wider
                screens it centers to a comfortable width instead of stretching. */}
            {items.length > 0 && (
                <div className="fixed bottom-0 inset-x-0 bg-surface border-t border-hairline-strong p-4 z-20">
                    <div className="w-full md:max-w-md md:mx-auto flex items-center gap-2">
                        <button onClick={clearCart}
                            title="Clear cart"
                            className="shrink-0 border border-hairline-strong text-ink-muted py-3 px-4 rounded-xl font-medium hover:bg-surface-muted transition-colors">
                            Clear
                        </button>
                        <button onClick={() => setShowCheckout(true)}
                            className="flex-1 bg-ink text-white py-3 rounded-xl font-medium flex items-center justify-center gap-2">
                            <ShoppingBag size={18} />
                            Checkout ({items.reduce((s, i) => s + i.quantity, 0)} items) — {money(totalAmount())}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
