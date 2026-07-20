import { requireRole } from '@/lib/auth'
import { getAllStaffAcrossRestaurants } from '../actions'
import { Users, CheckCircle, XCircle } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

const ROLE_COLORS: Record<string, string> = {
    super_admin: 'bg-indigo-100 text-indigo-700',
    manager: 'bg-blue-100 text-blue-700',
    kitchen: 'bg-brand-100 text-orange-700',
    waiter: 'bg-teal-100 text-teal-700',
}

const TIER_COLORS: Record<string, string> = {
    free: 'bg-surface-muted text-ink-muted',
    basic: 'bg-blue-100 text-blue-700',
    pro: 'bg-purple-100 text-purple-700',
    enterprise: 'bg-amber-100 text-amber-700',
}

export default async function StaffPage() {
    await requireRole('super_admin')

    const result = await getAllStaffAcrossRestaurants()
    const staff = (result.data || []) as Array<{
        id: string
        full_name: string
        email: string
        is_active: boolean
        restaurant_id: string
        role_id: number
        restaurants: { name: string; subscription_tier: string } | null
        roles: { name: string } | null
    }>

    const activeCount = staff.filter(s => s.is_active).length
    const byRole: Record<string, number> = {}
    staff.forEach(s => {
        const role = s.roles?.name || 'unknown'
        byRole[role] = (byRole[role] || 0) + 1
    })

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Platform Staff" 
                description="All staff members across every restaurant tenant." 
                icon={<Users size={18} />}
                color="purple"
            />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{staff.length}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Total Staff</div>
                </div>
                <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                    <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tabular-nums">{activeCount}</div>
                    <div className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Active</div>
                </div>
                {Object.entries(byRole).slice(0, 2).map(([role, count]) => (
                    <div key={role} className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                        <div className="text-2xl sm:text-3xl font-extrabold text-ink tabular-nums">{count}</div>
                        <div className="text-xs text-ink-subtle mt-0.5 capitalize">{role.replace('_', ' ')}</div>
                    </div>
                ))}
            </div>

            {/* Role breakdown */}
            <div className="bg-surface rounded-2xl border border-hairline-strong shadow-sm p-5">
                <h2 className="font-semibold text-ink mb-3 text-sm">Role Breakdown</h2>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(byRole).map(([role, count]) => (
                        <span key={role} className={`px-3 py-1.5 rounded-full text-xs font-semibold ${ROLE_COLORS[role] || 'bg-surface-muted text-ink-muted'}`}>
                            {role.replace('_', ' ')}: {count}
                        </span>
                    ))}
                </div>
            </div>

            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-4 border-b border-hairline bg-surface-muted/50">
                    <h2 className="font-semibold text-ink">All Staff Members</h2>
                </div>

                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 text-xs text-ink-subtle uppercase font-semibold border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left">Name</th>
                                <th className="px-5 py-3 text-left">Restaurant</th>
                                <th className="px-5 py-3 text-left">Tier</th>
                                <th className="px-5 py-3 text-left">Role</th>
                                <th className="px-5 py-3 text-left">Email</th>
                                <th className="px-5 py-3 text-center">Active</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {staff.map(s => (
                                <tr key={s.id} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-ink">{s.full_name}</td>
                                    <td className="px-5 py-3 text-ink-muted">{s.restaurants?.name || '—'}</td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${TIER_COLORS[s.restaurants?.subscription_tier || 'free'] || TIER_COLORS.free}`}>
                                            {s.restaurants?.subscription_tier || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ROLE_COLORS[s.roles?.name || ''] || 'bg-surface-muted text-ink-muted'}`}>
                                            {s.roles?.name?.replace('_', ' ') || '—'}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-ink-subtle text-xs">{s.email || '—'}</td>
                                    <td className="px-5 py-3 text-center">
                                        {s.is_active
                                            ? <CheckCircle size={14} className="text-emerald-500 mx-auto" />
                                            : <XCircle size={14} className="text-red-400 mx-auto" />
                                        }
                                    </td>
                                </tr>
                            ))}
                            {staff.length === 0 && (
                                <tr><td colSpan={6} className="px-5 py-12 text-center text-ink-subtle">No staff found</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile */}
                <div className="md:hidden divide-y divide-hairline">
                    {staff.map(s => (
                        <div key={s.id} className="p-4 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 text-indigo-700 font-bold text-sm">
                                {s.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-medium text-ink text-sm truncate">{s.full_name}</p>
                                <p className="text-xs text-ink-subtle truncate">{s.restaurants?.name} · {s.roles?.name?.replace('_', ' ')}</p>
                            </div>
                            {s.is_active
                                ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                                : <XCircle size={14} className="text-red-400 shrink-0" />
                            }
                        </div>
                    ))}
                    {staff.length === 0 && (
                        <div className="p-12 text-center text-ink-subtle">
                            <Users size={32} className="mx-auto mb-2 opacity-40" />
                            <p className="text-sm">No staff found</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
