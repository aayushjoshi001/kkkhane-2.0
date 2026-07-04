
'use client'

import { useState } from 'react'
import { upsertLoyaltyConfigAction } from './actions'
import type { LoyaltyConfig, LoyaltyMember } from '@/types/database'
import { Save, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useFeatures } from '@/lib/contexts/FeatureContext'

const TIER_COLORS: Record<string, string> = {
    bronze: 'bg-amber-100 text-amber-800 border-amber-200',
    silver: 'bg-surface-muted text-ink-subtle border-hairline',
    gold: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    platinum: 'bg-brand-50 text-brand-700 border-brand-200',
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
            <div className="bg-surface rounded-card border border-hairline shadow-sm p-6 space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-hairline">
                    <h2 className="text-h3 font-extrabold text-ink">Program Settings</h2>
                    <label className="flex items-center gap-2 text-sm font-bold text-ink cursor-pointer">
                        <input type="checkbox" checked={config.is_active} onChange={e => setConfig({ ...config, is_active: e.target.checked })}
                            className="rounded-[4px] border-hairline text-brand-500 focus:ring-brand-500 w-4 h-4 cursor-pointer" />
                        Program Active
                    </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Points per {currencySymbol}1</label>
                        <input type="number" step="0.1" value={config.points_per_dollar} onChange={e => setConfig({ ...config, points_per_dollar: +e.target.value })}
                            className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Redeem Threshold (pts)</label>
                        <input type="number" value={config.redemption_threshold} onChange={e => setConfig({ ...config, redemption_threshold: +e.target.value })}
                            className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Redeem Value ({currencySymbol})</label>
                        <input type="number" step="0.01" value={config.redemption_value} onChange={e => setConfig({ ...config, redemption_value: +e.target.value })}
                            className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-1.5">Signup Bonus (pts)</label>
                        <input type="number" value={config.signup_bonus_points} onChange={e => setConfig({ ...config, signup_bonus_points: +e.target.value })}
                            className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-4 py-2.5 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all tabular-nums" />
                    </div>
                </div>

                <div className="pt-2">
                    <h3 className="text-sm font-bold text-ink mb-4">Tier Thresholds <span className="text-ink-subtle font-medium">(lifetime points)</span></h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
                        <div className="bg-surface-muted/30 p-4 rounded-[var(--r-md)] border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">🥈 Silver</label>
                            <input type="number" value={config.silver_threshold} onChange={e => setConfig({ ...config, silver_threshold: +e.target.value })}
                                className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-3 py-2 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all tabular-nums" />
                        </div>
                        <div className="bg-surface-muted/30 p-4 rounded-[var(--r-md)] border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">🥇 Gold</label>
                            <input type="number" value={config.gold_threshold} onChange={e => setConfig({ ...config, gold_threshold: +e.target.value })}
                                className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-3 py-2 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all tabular-nums" />
                        </div>
                        <div className="bg-surface-muted/30 p-4 rounded-[var(--r-md)] border border-hairline shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)]">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wide mb-2 flex items-center gap-1.5">💎 Platinum</label>
                            <input type="number" value={config.platinum_threshold} onChange={e => setConfig({ ...config, platinum_threshold: +e.target.value })}
                                className="w-full rounded-[var(--r-md)] border border-hairline bg-surface px-3 py-2 text-sm font-bold text-ink outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 transition-all tabular-nums" />
                        </div>
                    </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-hairline">
                    <button onClick={handleSave} disabled={saving}
                        className="flex items-center gap-2 bg-brand-500 text-white px-6 py-2.5 rounded-[var(--r-md)] text-sm font-bold disabled:opacity-50 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all focus-ring">
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </div>

            {/* Members Table */}
            <div className="bg-surface rounded-card border border-hairline shadow-sm overflow-hidden">
                <div className="px-6 py-5 border-b border-hairline flex items-center gap-2 bg-surface-muted/30">
                    <Crown size={20} className="text-amber-500" />
                    <h2 className="text-h3 font-extrabold text-ink">Members <span className="text-ink-subtle font-medium text-sm ml-1">({initialMembers.length})</span></h2>
                </div>
                <div className="overflow-x-auto">
                <table className="w-full text-sm whitespace-nowrap">
                    <thead className="bg-surface-muted border-b border-hairline">
                        <tr>
                            <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle">Phone</th>
                            <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle hidden md:table-cell">Name</th>
                            <th className="text-left px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle">Tier</th>
                            <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle">Balance</th>
                            <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle hidden md:table-cell">Lifetime</th>
                            <th className="text-right px-6 py-4 font-bold text-[11px] uppercase tracking-wider text-ink-subtle hidden lg:table-cell">Visits</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {initialMembers.map(m => (
                            <tr key={m.id} className="hover:bg-surface-muted/50 transition-colors">
                                <td className="px-6 py-4 font-mono font-bold text-ink">{m.phone}</td>
                                <td className="px-6 py-4 text-ink font-medium hidden md:table-cell">{m.display_name || '—'}</td>
                                <td className="px-6 py-4">
                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider border ${TIER_COLORS[m.tier] || 'bg-surface-muted text-ink-subtle border-hairline'}`}>
                                        {m.tier}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right font-extrabold tabular-nums text-ink">{m.points_balance}</td>
                                <td className="px-6 py-4 text-right font-medium tabular-nums text-ink-subtle hidden md:table-cell">{m.lifetime_points}</td>
                                <td className="px-6 py-4 text-right font-medium tabular-nums text-ink-subtle hidden lg:table-cell">{m.visit_count}</td>
                            </tr>
                        ))}
                        {initialMembers.length === 0 && (
                            <tr><td colSpan={6} className="px-6 py-12 text-center text-ink-subtle font-bold">No members yet.</td></tr>
                        )}
                    </tbody>
                </table>
                </div>
            </div>
        </div>
    )
}
