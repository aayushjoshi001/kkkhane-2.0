'use client'

import { useCartStore } from '@/lib/stores/cart'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { ChevronRight, X } from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'

export default function CartSummary({ sessionId, tableSlug }: { sessionId?: string; tableSlug?: string }) {
    const items = useHydratedStore(useCartStore, (s) => s.items)
    const storeSlug = useHydratedStore(useCartStore, (s) => s.restaurantSlug)
    const clearCart = useCartStore((s) => s.clearCart)
    const searchParams = useSearchParams()
    const isWaiter = searchParams.get('w') === '1'

    const count = items?.reduce((acc, item) => acc + item.quantity, 0) || 0
    const slug = tableSlug || storeSlug || 'menu'
    const cartUrl = `/t/${slug}/cart${isWaiter ? '?w=1' : ''}`

    if (count === 0 || !sessionId) return null

    // Get the thumbnail of the last added item
    const lastItem = items && items.length > 0 ? items[items.length - 1] : null
    const lastImageUrl = lastItem?.imageUrl || null

    return (
        <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none pb-4 animate-fade-in"
             style={{ paddingBottom: 'env(safe-area-inset-bottom, 16px)' }}>
            <div className="max-w-md mx-auto px-4 pointer-events-auto">
                <div 
                    className="flex items-center justify-between w-full px-4 py-3 rounded-2xl text-white shadow-lg shadow-orange-950/20"
                    style={{
                        background: '#FB6303',
                    }}
                >
                    {/* Left: Close + Thumbnail + Count */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                clearCart()
                            }}
                            title="Clear Cart"
                            className="p-1 hover:bg-white/10 rounded-full text-white/80 hover:text-white transition active:scale-90"
                        >
                            <X size={14} className="stroke-[3px]" />
                        </button>
                        <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-white/20 shrink-0">
                            {lastImageUrl ? (
                                <Image
                                    src={lastImageUrl}
                                    alt="Last item"
                                    fill
                                    className="object-cover"
                                    sizes="32px"
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <span className="text-sm">🍽️</span>
                                </div>
                            )}
                        </div>
                        <span className="text-xs font-bold text-white leading-none">
                            {count} Item{count !== 1 ? 's' : ''} added
                        </span>
                    </div>

                    {/* Right: Link to Cart */}
                    <Link
                        href={cartUrl}
                        className="flex items-center gap-0.5 text-xs font-bold text-white hover:opacity-90 active:scale-95 transition-transform"
                    >
                        View Cart
                        <ChevronRight size={14} className="stroke-[3px]" />
                    </Link>
                </div>
            </div>
        </div>
    )
}
