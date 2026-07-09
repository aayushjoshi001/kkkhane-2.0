'use client'

import Link from 'next/link'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import { Home, ChefHat, ShoppingBag, CreditCard } from 'lucide-react'
import { useCartStore } from '@/lib/stores/cart'
import { useActiveOrders } from '@/lib/stores/activeOrders'
import { useHydratedStore } from '@/lib/stores/useHydratedStore'
import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'

interface BottomNavbarProps {
    activeTab?: 'home' | 'orders' | 'cart' | 'pay'
    onHomeClick?: () => void
}

export default function BottomNavbar({ activeTab, onHomeClick }: BottomNavbarProps) {
    const params = useParams<{ tableSlug: string }>()
    const searchParams = useSearchParams()
    const router = useRouter()
    
    const [isMounted, setIsMounted] = useState(false)
    useEffect(() => {
        setIsMounted(true)
    }, [])

    const tableSlug = params.tableSlug
    const isWaiter = searchParams?.get('w') === '1'
    const queryStr = isWaiter ? '?w=1' : ''

    const totalItems = useHydratedStore(useCartStore, (s) => s.totalItems)
    const cartCount = isMounted && totalItems ? totalItems() : 0

    const allOrders = useHydratedStore(useActiveOrders, (s) => s.orders) || []
    const currentTableOrders = isMounted
        ? allOrders.filter(o => o.slug === tableSlug && o.type === 'dine_in')
        : []

    const [dbOrders, setDbOrders] = useState<{ id: string; status: string }[]>([])

    useEffect(() => {
        if (!tableSlug) return
        fetch(`/api/tables/active-orders?tableSlug=${tableSlug}`)
            .then(res => res.json())
            .then(data => {
                if (data.orders) {
                    setDbOrders(data.orders)
                }
            })
            .catch(err => console.error('Failed to load active orders from DB:', err))
    }, [tableSlug])

    const latestOrder = dbOrders.length > 0
        ? dbOrders[dbOrders.length - 1]
        : (currentTableOrders.length > 0 ? currentTableOrders[currentTableOrders.length - 1] : null)

    if (!tableSlug) return null

    const handleHomeClick = (e: React.MouseEvent) => {
        if (onHomeClick && activeTab === 'home') {
            e.preventDefault()
            onHomeClick()
        }
    }

    const handleOrdersClick = (e: React.MouseEvent) => {
        if (!latestOrder) {
            e.preventDefault()
            toast.error("No active orders placed yet")
        }
    }

    return (
        <div className="fixed bottom-0 left-0 right-0 p-4 pb-6 z-40 bg-gradient-to-t from-black/80 via-black/50 to-transparent flex justify-center pointer-events-none font-sans">
            <div className="bg-[#FB6303] rounded-full px-6 py-3 shadow-2xl flex items-center gap-8 pointer-events-auto border border-white/10 animate-fade-in backdrop-blur-md">
                {/* Home */}
                <Link
                    href={`/t/${tableSlug}${queryStr}`}
                    onClick={handleHomeClick}
                    className={`flex flex-col items-center justify-center transition active:scale-95 w-16 ${
                        activeTab === 'home' ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                >
                    <Home size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Home</span>
                </Link>

                {/* Orders */}
                <Link
                    href={latestOrder ? `/t/${tableSlug}/order/${latestOrder.id}${queryStr}` : '#'}
                    onClick={handleOrdersClick}
                    className={`flex flex-col items-center justify-center transition active:scale-95 w-16 ${
                        activeTab === 'orders' ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                >
                    <ChefHat size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Orders</span>
                </Link>

                {/* Cart */}
                <Link
                    href={`/t/${tableSlug}/cart${queryStr}`}
                    className={`flex flex-col items-center justify-center transition active:scale-95 w-16 relative ${
                        activeTab === 'cart' ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                >
                    {cartCount > 0 && (
                        <span className="absolute -top-1.5 right-3 bg-surface text-brand-500 text-[9px] font-black rounded-full h-[18px] min-w-[18px] px-1 flex items-center justify-center ring-2 ring-[#FB6303]">
                            {cartCount}
                        </span>
                    )}
                    <ShoppingBag size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Cart</span>
                </Link>

                {/* Payment */}
                <Link
                    href={`/t/${tableSlug}/checkout${queryStr}`}
                    className={`flex flex-col items-center justify-center transition active:scale-95 w-16 ${
                        activeTab === 'pay' ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                >
                    <CreditCard size={18} className="stroke-[2.5px] text-white" />
                    <span className="text-[10px] font-extrabold mt-1 uppercase tracking-wider">Pay</span>
                </Link>
            </div>
        </div>
    )
}
