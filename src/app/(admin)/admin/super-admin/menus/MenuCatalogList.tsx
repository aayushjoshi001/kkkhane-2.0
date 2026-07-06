'use client'

import { useState } from 'react'
import { UtensilsCrossed, ChevronDown, ChevronRight, CheckCircle, XCircle, Search } from 'lucide-react'

interface MenuGroup {
    id: string
    name: string
    subscription_tier: string
    totalItems: number
    availableItems: number
    items: Array<{
        id: string
        name: string
        price: number
        is_available: boolean
        menu_categories: { name: string } | null
    }>
}

const TIER_COLORS: Record<string, string> = {
    free: 'bg-gray-100 text-gray-600',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

export default function MenuCatalogList({ groups }: { groups: MenuGroup[] }) {
    const [expanded, setExpanded] = useState<Set<string>>(new Set())
    const [search, setSearch] = useState('')

    const filtered = groups.filter(g =>
        g.name.toLowerCase().includes(search.toLowerCase())
    )

    const toggle = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    return (
        <>
            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text"
                    placeholder="Search restaurants..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
                />
            </div>

            {/* Accordion */}
            <div className="space-y-2">
                {filtered.map(group => (
                    <div key={group.id} className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        <button
                            onClick={() => toggle(group.id)}
                            className="w-full flex items-center gap-4 p-4 md:p-5 text-left hover:bg-gray-50 transition"
                        >
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                                <UtensilsCrossed size={16} className="text-indigo-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-gray-900">{group.name}</span>
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[group.subscription_tier] || TIER_COLORS.free}`}>
                                        {group.subscription_tier}
                                    </span>
                                </div>
                                <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">
                                    {group.totalItems} items · {group.availableItems} available
                                </p>
                            </div>
                            {expanded.has(group.id) ? <ChevronDown size={16} className="text-gray-400 shrink-0" /> : <ChevronRight size={16} className="text-gray-400 shrink-0" />}
                        </button>

                        {expanded.has(group.id) && (
                            <div className="border-t border-gray-100">
                                {group.items.length === 0 ? (
                                    <p className="px-5 py-4 text-sm text-gray-400">No menu items yet.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead className="bg-gray-50/50 text-xs text-gray-500 uppercase font-semibold">
                                                <tr>
                                                    <th className="px-5 py-3 text-left">Item</th>
                                                    <th className="px-5 py-3 text-left">Category</th>
                                                    <th className="px-5 py-3 text-right">Price</th>
                                                    <th className="px-5 py-3 text-center">Available</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {group.items.map((item) => (
                                                    <tr key={item.id} className="group hover:bg-gray-50/50 transition-colors">
                                                        <td className="px-5 py-3 font-medium text-gray-900">{item.name}</td>
                                                        <td className="px-5 py-3 text-gray-500">{item.menu_categories?.name || '—'}</td>
                                                        <td className="px-5 py-3 text-right text-gray-900">Rs. {item.price.toFixed(2)}</td>
                                                        <td className="px-5 py-3 text-center">
                                                            {item.is_available
                                                                ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                                                                : <XCircle size={14} className="text-red-400 mx-auto" />
                                                            }
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="text-center py-16 text-gray-400">
                        <UtensilsCrossed size={36} className="mx-auto mb-3 opacity-40" />
                        <p>No restaurants found</p>
                    </div>
                )}
            </div>
        </>
    )
}
