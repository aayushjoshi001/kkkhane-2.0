
'use client'

import { useState } from 'react'
import { upsertLoyaltyConfigAction } from './actions'
import type { LoyaltyConfig, LoyaltyMember } from '@/types/database'
import { Save, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFeatures } from '@/lib/contexts/FeatureContext'

const TIER_COLORS: Record<string, string> = {
    bronze: 'bg-amber-100 text-amber-800',
    silver: 'bg-gray-200 text-gray-700',
    gold: 'bg-yellow-100 text-yellow-800',
    platinum: 'bg-purple-100 text-purple-800',
}

export default function LoyaltyManager({ initialConfig, initialMembers, restaurantId }: {
    initialConfig: LoyaltyConfig | null
    initialMembers: LoyaltyMember[]
    restaurantId: string
}) {
    const { currencySymbol } = useFeatures()
    const [config, setConfig] = useState({
        points_per_dollar: initialConfig?.points_per_dollar ?? 1,
        redemption_threshold: initialConfig?.redemption_threshold ?? 100,
        redemption_value: initialConfig?.redemption_value ?? 5,
        signup_bonus_points: initialConfig?.signup_bonus_points ?? 10,
        birthday_bonus_points: initialConfig?.birthday_bonus_points ?? 0,
        silver_threshold: initialConfig?.silver_threshold ?? 500,
        gold_threshold: initialConfig?.gold_threshold ?? 2000,
        platinum_threshold: initialConfig?.platinum_threshold ?? 5000,
        is_active: initialConfig?.is_active ?? true,
    })
    const [saving, setSaving] = useState(false)

    async function handleSave() {
        setSaving(true)
        const result = await upsertLoyaltyConfigAction({ restaurant_id: restaurantId, ...config })
        setSaving(false)
        if (result.error) { toast.error(result.error); return }
        toast.success('Loyalty config saved!')
    }

    return (
        <div className="space-y-6">
            {/* Configuration */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold text-gray-900">Program Settings</h2>
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={config.is_active} onChange={e => setConfig({ ...config, is_active: e.target.checked })}
                            className="rounded border-gray-300" />
                        Active
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Points per {currencySymbol}1</label>
                        <input type="number" step="0.1" value={config.points_per_dollar} onChange={e => setConfig({ ...config, points_per_dollar: +e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Redeem Threshold (pts)</label>
                        <input type="number" value={config.redemption_threshold} onChange={e => setConfig({ ...config, redemption_threshold: +e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Redeem Value ({currencySymbol})</label>
                        <input type="number" step="0.01" value={config.redemption_value} onChange={e => setConfig({ ...config, redemption_value: +e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-600 mb-1">Signup Bonus (pts)</label>
                        <input type="number" value={config.signup_bonus_points} onChange={e => setConfig({ ...config, signup_bonus_points: +e.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                    </div>
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-700 mb-3">Tier Thresholds (lifetime points)</h3>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">🥈 Silver</label>
                            <input type="number" value={config.silver_threshold} onChange={e => setConfig({ ...config, silver_threshold: +e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">🥇 Gold</label>
                            <input type="number" value={config.gold_threshold} onChange={e => setConfig({ ...config, gold_threshold: +e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">💎 Platinum</label>
                            <input type="number" value={config.platinum_threshold} onChange={e => setConfig({ ...config, platinum_threshold: +e.target.value })}
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end">
                    <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-2 bg-gray-900 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Config'}
                    </button>
                </div>
            </div>

            {/* Members Table */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
                    <Crown size={18} className="text-yellow-500" />
                    <h2 className="font-semibold text-gray-900">Members ({initialMembers.length})</h2>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                        <tr>
                            <th className="text-left px-4 py-3 font-medium">Phone</th>
                            <th className="text-left px-4 py-3 font-medium hidden md:table-cell">Name</th>
                            <th className="text-left px-4 py-3 font-medium">Tier</th>
                            <th className="text-right px-4 py-3 font-medium">Balance</th>
                            <th className="text-right px-4 py-3 font-medium hidden md:table-cell">Lifetime</th>
                            <th className="text-right px-4 py-3 font-medium hidden lg:table-cell">Visits</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {initialMembers.map(m => (
                            <tr key={m.id} className="hover:bg-gray-50">
                                <td className="px-4 py-3 font-mono text-gray-700">{m.phone}</td>
                                <td className="px-4 py-3 text-gray-600 hidden md:table-cell">{m.display_name || '—'}</td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${TIER_COLORS[m.tier] || 'bg-gray-100 text-gray-600'}`}>
                                        {m.tier}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right font-semibold text-gray-900">{m.points_balance}</td>
                                <td className="px-4 py-3 text-right text-gray-500 hidden md:table-cell">{m.lifetime_points}</td>
                                <td className="px-4 py-3 text-right text-gray-500 hidden lg:table-cell">{m.visit_count}</td>
                            </tr>
                        ))}
                        {initialMembers.length === 0 && (
                            <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No members yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
