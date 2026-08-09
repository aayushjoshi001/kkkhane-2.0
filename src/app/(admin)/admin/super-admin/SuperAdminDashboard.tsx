'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, ShoppingBag, Crown, Ban, CheckCircle, Loader2, ChevronDown, Plus, X, Store, UserRound, Mail, KeyRound, Phone, MapPin, Check, CreditCard, AlertTriangle, Search, Filter, Wallet, Settings, Printer, ChefHat } from 'lucide-react'
import { createTenantWithOwner, suspendRestaurant, updateSubscriptionTier, sendPasswordResetEmail, updateOwnerContact, recordSubscriptionPayment, toggleRestaurantFinance, updateRestaurantFeatures } from './actions'
import { TIER_LIMITS, TIERS, TIER_LABELS, FINANCE_TIERS, isUnlimited, type Tier } from '@/lib/tiers'
import { toast } from 'react-hot-toast'
import Select from '@/components/ui/Select'

interface Restaurant {
    id: string
    name: string
    slug: string
    is_active: boolean
    is_suspended: boolean
    subscription_tier: string
    subscription_status: string
    subscription_expires_at: string | null
    max_staff: number
    max_menu_items: number
    created_at: string
    users?: { email: string } | null
    financeEnabled?: boolean
    features?: any
    business_type?: string | null
}

interface SaasMetrics {
    totalRestaurants: number
    activeRestaurants: number
    totalOrders: number
    tierBreakdown: Record<string, number>
}

// Keyed loosely: subscription_tier arrives from the DB as a plain string, so an
// unrecognised value falls through to the caller's fallback rather than crashing.
const TIER_COLORS: Record<string, string> = {
    free:       'bg-surface-muted text-ink-muted border-hairline-strong',
    basic:      'bg-blue-100 text-blue-700 border-blue-200',
    premium:    'bg-purple-100 text-purple-700 border-purple-200',
    platinum:   'bg-slate-200 text-slate-800 border-slate-300',
    enterprise: 'bg-amber-100 text-amber-700 border-amber-200',
}

export default function SuperAdminDashboard({
    restaurants,
    metrics,
}: {
    restaurants: Restaurant[]
    metrics: SaasMetrics
}) {
    const [items, setItems] = useState(restaurants)
    const [loading, setLoading] = useState<string | null>(null)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [isCreatingTenant, setIsCreatingTenant] = useState(false)
    const [manageOwnerModal, setManageOwnerModal] = useState<{
        isOpen: boolean
        restaurant: Restaurant | null
        action: 'password' | 'contact'
        email?: string
        phone?: string
    }>({
        isOpen: false,
        restaurant: null,
        action: 'password',
        email: undefined,
        phone: undefined,
    })
    const [isUpdatingOwner, setIsUpdatingOwner] = useState(false)
    const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; restaurant: Restaurant | null }>({ isOpen: false, restaurant: null })
    const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', reference: '', notes: '' })
    const [isRecordingPayment, setIsRecordingPayment] = useState(false)
    const [createForm, setCreateForm] = useState({
        restaurantName: '',
        restaurantSlug: '',
        ownerFullName: '',
        ownerEmail: '',
        ownerPassword: '',
        contactPhone: '',
        address: '',
        subscriptionTier: 'free' as Tier,
        businessType: 'Restaurant',
    })
    const router = useRouter()

    const [searchQuery, setSearchQuery] = useState('')
    const [tierFilter, setTierFilter] = useState<'all' | Tier>('all')
    const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')

    const filteredItems = useMemo(() => {
        return items.filter(r => {
            const matchesSearch = r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                  (r.users?.email || '').toLowerCase().includes(searchQuery.toLowerCase())
            const matchesTier = tierFilter === 'all' || r.subscription_tier === tierFilter
            const matchesStatus = statusFilter === 'all' || (statusFilter === 'suspended' ? r.is_suspended : !r.is_suspended)
            return matchesSearch && matchesTier && matchesStatus
        })
    }, [items, searchQuery, tierFilter, statusFilter])

    const handleCreateFormChange = (field: keyof typeof createForm, value: string) => {
        setCreateForm(prev => {
            if (field === 'restaurantName') {
                const nextName = value
                const previousGeneratedSlug = prev.restaurantName
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')
                const generatedSlug = nextName
                    .trim()
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '')

                return {
                    ...prev,
                    restaurantName: nextName,
                    restaurantSlug: prev.restaurantSlug === '' || prev.restaurantSlug === previousGeneratedSlug
                        ? generatedSlug
                        : prev.restaurantSlug,
                }
            }

            if (field === 'restaurantSlug') {
                return {
                    ...prev,
                    restaurantSlug: value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, '-')
                        .replace(/--+/g, '-')
                        .replace(/^-+|-+$/g, ''),
                }
            }

            return { ...prev, [field]: value }
        })
    }

    const resetCreateForm = () => {
        setCreateForm({
            restaurantName: '',
            restaurantSlug: '',
            ownerFullName: '',
            ownerEmail: '',
            ownerPassword: '',
            contactPhone: '',
            address: '',
            subscriptionTier: 'free',
            businessType: 'Restaurant',
        })
    }

    const handleCreateTenant = async () => {
        if (!createForm.restaurantName || !createForm.ownerFullName || !createForm.ownerEmail || !createForm.ownerPassword) {
            toast.error('Complete the required restaurant and owner fields')
            return
        }

        setIsCreatingTenant(true)
        const result = await createTenantWithOwner(createForm)
        setIsCreatingTenant(false)

        if (!result.success || !result.restaurant) {
            toast.error(result.error || 'Failed to create client')
            return
        }

        setItems(prev => [result.restaurant, ...prev])
        resetCreateForm()
        setIsCreateModalOpen(false)
        toast.success('Client created with owner account and default settings')
        router.refresh()
    }

    const handleSuspend = async (id: string, suspend: boolean) => {
        setLoading(id)
        const res = await suspendRestaurant(id, suspend)
        if (res.success) {
            setItems(prev => prev.map(r => r.id === id ? { ...r, is_suspended: suspend } : r))
            toast.success(suspend ? 'Restaurant suspended' : 'Restaurant reactivated')
        } else {
            toast.error(res.error || 'Failed')
        }
        setLoading(null)
    }

    const handleTierChange = async (id: string, tier: Tier) => {
        setLoading(id)
        const res = await updateSubscriptionTier(id, tier)
        if (res.success) {
            // Mirror what updateSubscriptionTier just wrote, so the row updates
            // without a refetch. Same source as the server action.
            const { max_staff, max_menu_items } = TIER_LIMITS[tier]
            setItems(prev =>
                prev.map(r =>
                    r.id === id
                        ? { ...r, subscription_tier: tier, max_staff, max_menu_items }
                        : r
                )
            )
            toast.success(`Tier changed to ${tier}`)
        } else {
            toast.error(res.error || 'Failed')
        }
        setLoading(null)
    }

    const handleIrdToggle = async (id: string, enabled: boolean) => {
        setLoading(id)
        const res = await updateRestaurantFeatures(id, { irdSyncEnabled: enabled })
        if (res.success) {
            setItems(prev =>
                prev.map(r =>
                    r.id === id
                        ? { 
                            ...r, 
                            features: { ...(r.features || {}), irdSyncEnabled: enabled }
                          }
                        : r
                )
            )
            toast.success(enabled ? 'IRD Certification & Finance enabled' : 'IRD Certification & Finance disabled')
        } else {
            toast.error(res.error || 'Failed')
        }
        setLoading(null)
    }

    const handleFeatureToggle = async (id: string, key: 'kotEnabled' | 'kdsEnabled', enabled: boolean) => {
        setLoading(id)
        // Independent switches — a restaurant may run the screen, the printer,
        // both (the default) or neither.
        const updatePayload: any = { [key]: enabled }

        const res = await updateRestaurantFeatures(id, updatePayload)
        if (res.success) {
            setItems(prev =>
                prev.map(r =>
                    r.id === id
                        ? { 
                            ...r, 
                            features: { ...(r.features || {}), ...updatePayload }
                          }
                        : r
                )
            )
            toast.success(`Features updated successfully`)
        } else {
            toast.error(res.error || 'Failed')
        }
        setLoading(null)
    }

    const handleOwnerAction = async () => {
        if (!manageOwnerModal.restaurant) return
        const restaurant = manageOwnerModal.restaurant
        const ownerEmail = restaurant.users?.email || ''

        setIsUpdatingOwner(true)

        if (manageOwnerModal.action === 'password') {
            const result = await sendPasswordResetEmail(restaurant.id, ownerEmail)
            if (result.success) {
                toast.success(result.message || 'Password reset email sent')
                setManageOwnerModal({ isOpen: false, restaurant: null, action: 'password' })
            } else {
                toast.error(result.error || 'Failed to send reset email')
            }
        } else if (manageOwnerModal.action === 'contact') {
            const updates: Record<string, string | undefined> = {}
            if (manageOwnerModal.email && manageOwnerModal.email !== ownerEmail) {
                updates.email = manageOwnerModal.email
            }
            if (manageOwnerModal.phone) {
                updates.phone = manageOwnerModal.phone
            }

            if (Object.keys(updates).length === 0) {
                toast.error('No changes to save')
                setIsUpdatingOwner(false)
                return
            }

            const result = await updateOwnerContact(restaurant.id, updates as Parameters<typeof updateOwnerContact>[1])
            if (result.success) {
                toast.success('Owner contact information updated')
                setManageOwnerModal({ isOpen: false, restaurant: null, action: 'password' })
            } else {
                toast.error(result.error || 'Failed to update contact')
            }
        }

        setIsUpdatingOwner(false)
    }

    const handleRecordPayment = async () => {
        if (!paymentModal.restaurant || !paymentForm.amount) return
        setIsRecordingPayment(true)
        const res = await recordSubscriptionPayment(
            paymentModal.restaurant.id,
            parseFloat(paymentForm.amount),
            paymentForm.method,
            paymentForm.reference,
            paymentForm.notes
        )
        if (res.success) {
            toast.success('Payment recorded. Subscription extended by 30 days.')
            setPaymentModal({ isOpen: false, restaurant: null })
            setPaymentForm({ amount: '', method: 'cash', reference: '', notes: '' })
        } else {
            toast.error(res.error || 'Failed to record payment')
        }
        setIsRecordingPayment(false)
    }

    // Restaurants expiring within 7 days. `now` is seeded once on mount so the
    // filter stays a pure computation across re-renders (React 19 purity).
    const [now] = useState(() => Date.now())
    const expiringSoon = useMemo(() => items.filter(r => {
        if (!r.subscription_expires_at) return false
        const diff = new Date(r.subscription_expires_at).getTime() - now
        return diff > 0 && diff < 7 * 24 * 3600 * 1000
    }), [items, now])

    return (
        <div className="space-y-5 md:space-y-6">

            {/* Metrics Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 animate-fade-up" style={{ animationDelay: '0.1s' }}>
                <MetricCard icon={Building2}   color="indigo"  label="Total Tenants"  value={metrics.totalRestaurants} />
                <MetricCard icon={CheckCircle} color="emerald" label="Active"         value={metrics.activeRestaurants} />
                <MetricCard icon={ShoppingBag} color="blue"    label="Total Orders"   value={metrics.totalOrders} />
                <MetricCard icon={Crown}       color="purple"  label="Premium+ Accounts"  value={(metrics.tierBreakdown.premium || 0) + (metrics.tierBreakdown.platinum || 0) + (metrics.tierBreakdown.enterprise || 0)} />
            </div>

            {/* Tier Breakdown */}
            <div className="bg-surface rounded-[24px] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-hairline p-6 animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <h3 className="font-bold text-ink text-[1.15rem] mb-4">Subscription Distribution</h3>
                <div className="flex gap-3 flex-wrap">
                    {Object.entries(metrics.tierBreakdown).map(([tier, count]) => (
                        <div key={tier} className={`px-4 py-2 rounded-xl text-[13px] font-bold border shadow-sm flex items-center gap-2 ${TIER_COLORS[tier] || 'bg-surface-muted text-ink-muted'}`}>
                            <span className="capitalize">{tier}</span>
                            <span className="bg-surface/50 px-1.5 py-0.5 rounded-md tabular-nums">{count}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Expiring Soon Banner */}
            {expiringSoon.length > 0 && (
                <div className="bg-surface rounded-[24px] border border-amber-200 shadow-[0_8px_30px_rgb(245,158,11,0.06)] overflow-hidden relative group animate-fade-up" style={{ animationDelay: '0.15s' }}>
                    <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
                    <div className="p-6 flex items-start gap-3">
                        <AlertTriangle size={24} className="text-amber-500 shrink-0 mt-0.5 animate-pulse" />
                        <div className="flex-1">
                            <p className="font-bold text-amber-800 text-[15px]">Subscriptions renewing soon</p>
                            <ul className="mt-2 space-y-2">
                                {expiringSoon.map(r => (
                                    <li key={r.id} className="flex items-center justify-between text-sm">
                                        <span className="font-medium text-ink-muted">
                                            <strong>{r.name}</strong>
                                        </span>
                                        <span className="text-[13px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-md border border-amber-100">
                                            expires {r.subscription_expires_at ? new Date(r.subscription_expires_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : 'unknown'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            )}

            {/* Restaurant List */}
            <div className="bg-surface rounded-[24px] shadow-[0_4px_20px_rgb(0,0,0,0.03)] border border-hairline overflow-hidden animate-fade-up" style={{ animationDelay: '0.3s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <h2 className="text-[1.15rem] font-bold text-ink">All Businesses</h2>
                        <p className="text-[13px] text-ink-subtle mt-0.5">Manage tenants, tiers, and suspension</p>
                    </div>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_0_15px_rgba(79,70,229,0.2)] transition-all hover:bg-indigo-500 hover:-translate-y-0.5 hover:shadow-[0_0_20px_rgba(79,70,229,0.3)]"
                    >
                        <Plus size={16} />
                        Add Client
                    </button>
                </div>

                {/* Filters */}
                <div className="px-5 py-3 border-b border-hairline flex flex-col sm:flex-row gap-3 bg-surface">
                    <div className="relative flex-1">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                        <input
                            type="text"
                            placeholder="Search by name or owner email..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-hairline-strong text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>
                    <div className="flex gap-3">
                        <Select
                            value={tierFilter}
                            onChange={(e) => setTierFilter(e.target.value as any)}
                            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink-muted outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 w-full sm:w-auto"
                        >
                            <option value="all">All Tiers</option>
                            {TIERS.map(t => (
                                <option key={t} value={t}>{TIER_LABELS[t]}</option>
                            ))}
                        </Select>
                        <Select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as any)}
                            className="rounded-xl border border-hairline-strong bg-surface px-3 py-2 text-sm text-ink-muted outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 w-full sm:w-auto"
                        >
                            <option value="all">All Status</option>
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                        </Select>
                    </div>
                </div>

                <div className="divide-y divide-hairline">
                    {filteredItems.map((restaurant) => (
                        <div
                            key={restaurant.id}
                            className={`group p-4 md:p-6 flex flex-col md:flex-row md:items-center gap-4 transition-colors hover:bg-surface-muted/50 ${
                                restaurant.is_suspended ? 'bg-red-50/30 hover:bg-red-50/50' : ''
                            }`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="font-semibold text-ink truncate">{restaurant.name}</h4>
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[restaurant.subscription_tier] || TIER_COLORS.free}`}>
                                        {(restaurant.subscription_tier || 'free').toUpperCase()}
                                    </span>
                                    {restaurant.business_type && (
                                        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900/60">
                                            {restaurant.business_type}
                                        </span>
                                    )}
                                    {restaurant.is_suspended && (
                                        <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                                            SUSPENDED
                                        </span>
                                    )}
                                </div>
                                <p className="text-sm text-ink-subtle mt-1">
                                    {restaurant.users?.email || 'No owner'} •
                                    Staff: {isUnlimited(restaurant.max_staff) ? 'Unlimited' : restaurant.max_staff} •
                                    Items: {isUnlimited(restaurant.max_menu_items) ? 'Unlimited' : restaurant.max_menu_items}
                                </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                {/* Record Payment Button */}
                                <button
                                    onClick={() => {
                                        setPaymentModal({ isOpen: true, restaurant })
                                        setPaymentForm({ amount: '', method: 'cash', reference: '', notes: '' })
                                    }}
                                    disabled={loading === restaurant.id}
                                    className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition"
                                    title="Record subscription payment"
                                >
                                    <CreditCard size={14} />
                                </button>

                                {/* Manage Owner Button */}
                                <button
                                    onClick={() => {
                                        const ownerEmail = restaurant.users?.email || ''
                                        setManageOwnerModal({
                                            isOpen: true,
                                            restaurant,
                                            action: 'password',
                                            email: ownerEmail,
                                            phone: '',
                                        })
                                    }}
                                    disabled={loading === restaurant.id}
                                    className="px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 disabled:opacity-50 transition"
                                    title="Manage owner account"
                                >
                                    <UserRound size={14} />
                                </button>

                                {/* Tier Selector */}
                                <div className="relative">
                                    <Select
                                        value={restaurant.subscription_tier || 'free'}
                                        onChange={(e) => handleTierChange(restaurant.id, e.target.value as Tier)}
                                        disabled={loading === restaurant.id}
                                        className="appearance-none bg-surface border border-hairline-strong rounded-lg px-3 py-2 pr-8 text-sm font-medium disabled:opacity-50"
                                    >
                                        {TIERS.map(t => (
                                            <option key={t} value={t}>{TIER_LABELS[t]}</option>
                                        ))}
                                    </Select>
                                    <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle pointer-events-none" />
                                </div>
                                
                                {/* IRD Sync Toggle */}
                                 <div
                                     className="flex items-center gap-2 px-3 py-2 border border-hairline-strong rounded-lg bg-surface transition-all select-none"
                                     title="Toggle IRD Certification & Financial Suite"
                                 >
                                     <Crown size={14} className={restaurant.features?.irdSyncEnabled ? "text-brand-500" : "text-ink-subtle"} />
                                     <span className="text-xs font-semibold text-ink-muted hidden sm:inline">IRD Sync</span>
                                     <label className="relative inline-flex items-center cursor-pointer group">
                                         <input
                                             type="checkbox"
                                             className="sr-only peer"
                                             checked={!!restaurant.features?.irdSyncEnabled}
                                             disabled={loading === restaurant.id}
                                             onChange={(e) => handleIrdToggle(restaurant.id, e.target.checked)}
                                         />
                                         <div className="w-9 h-5 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-all peer-disabled:opacity-40"></div>
                                     </label>
                                 </div>

                                 {/* KOT Toggle */}
                                  <div
                                      className="flex items-center gap-2 px-3 py-2 border border-hairline-strong rounded-lg bg-surface transition-all select-none"
                                      title="Toggle KOT Physical Ticket Printing"
                                  >
                                      <Printer size={14} className={restaurant.features?.kotEnabled ? "text-brand-500" : "text-ink-subtle"} />
                                      <span className="text-xs font-semibold text-ink-muted hidden sm:inline">KOT</span>
                                      <label className="relative inline-flex items-center cursor-pointer group">
                                          <input
                                              type="checkbox"
                                              className="sr-only peer"
                                              checked={!!restaurant.features?.kotEnabled}
                                              disabled={loading === restaurant.id}
                                              onChange={(e) => handleFeatureToggle(restaurant.id, 'kotEnabled', e.target.checked)}
                                          />
                                          <div className="w-9 h-5 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-all peer-disabled:opacity-40"></div>
                                      </label>
                                  </div>

                                 {/* KDS Toggle */}
                                  <div
                                      className="flex items-center gap-2 px-3 py-2 border border-hairline-strong rounded-lg bg-surface transition-all select-none"
                                      title="Toggle Digital Kitchen Display System"
                                  >
                                      <ChefHat size={14} className={restaurant.features?.kdsEnabled !== false ? "text-brand-500" : "text-ink-subtle"} />
                                      <span className="text-xs font-semibold text-ink-muted hidden sm:inline">KDS</span>
                                      <label className="relative inline-flex items-center cursor-pointer group">
                                          <input
                                              type="checkbox"
                                              className="sr-only peer"
                                              checked={restaurant.features?.kdsEnabled !== false}
                                              disabled={loading === restaurant.id}
                                              onChange={(e) => handleFeatureToggle(restaurant.id, 'kdsEnabled', e.target.checked)}
                                          />
                                          <div className="w-9 h-5 bg-surface-muted border border-hairline peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-500 peer-checked:border-brand-500 shadow-inner group-hover:shadow-md transition-all peer-disabled:opacity-40"></div>
                                      </label>
                                  </div>

                                {/* Suspend/Reactivate */}
                                <button
                                    onClick={() => handleSuspend(restaurant.id, !restaurant.is_suspended)}
                                    disabled={loading === restaurant.id}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50 ${
                                        restaurant.is_suspended
                                            ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                                            : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
                                    }`}
                                >
                                    {loading === restaurant.id ? (
                                        <Loader2 size={14} className="animate-spin" />
                                    ) : restaurant.is_suspended ? (
                                        <><CheckCircle size={14} /> Reactivate</>
                                    ) : (
                                        <><Ban size={14} /> Suspend</>
                                    )}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {filteredItems.length === 0 && (
                    <div className="p-12 text-center text-ink-subtle">
                        <Building2 size={40} className="mx-auto mb-3" />
                        <p>
                            {items.length === 0 
                                ? "No businesses registered yet" 
                                : "No businesses found matching your search or filters"}
                        </p>
                    </div>
                )}
            </div>

            {manageOwnerModal.isOpen && manageOwnerModal.restaurant && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-md rounded-3xl bg-surface shadow-2xl border border-hairline-strong overflow-hidden">
                        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
                            <div>
                                <h3 className="text-xl font-semibold text-ink">Manage Owner</h3>
                                <p className="mt-1 text-sm text-ink-subtle">{manageOwnerModal.restaurant.name}</p>
                            </div>
                            <button
                                onClick={() => setManageOwnerModal({ isOpen: false, restaurant: null, action: 'password' })}
                                className="rounded-lg p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink-muted"
                                aria-label="Close manage owner modal"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-6 px-6 py-6">
                            <div className="flex gap-3 border-b border-hairline pb-4">
                                <button
                                    onClick={() => setManageOwnerModal(prev => ({ ...prev, action: 'password' }))}
                                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                                        manageOwnerModal.action === 'password'
                                            ? 'bg-primary text-white'
                                            : 'bg-surface-muted text-ink-muted hover:bg-surface-muted'
                                    }`}
                                >
                                    Reset Password
                                </button>
                                <button
                                    onClick={() => setManageOwnerModal(prev => ({ ...prev, action: 'contact' }))}
                                    className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition ${
                                        manageOwnerModal.action === 'contact'
                                            ? 'bg-primary text-white'
                                            : 'bg-surface-muted text-ink-muted hover:bg-surface-muted'
                                    }`}
                                >
                                    Update Contact
                                </button>
                            </div>

                            {manageOwnerModal.action === 'password' && (
                                <div className="space-y-4">
                                    <div className="rounded-2xl bg-blue-50 border border-blue-200 p-4">
                                        <p className="text-sm text-blue-900">
                                            A password reset email will be sent to <span className="font-semibold">{manageOwnerModal.restaurant.users?.email || 'owner'}</span>. They can use this link to set a new password.
                                        </p>
                                    </div>
                                    <button
                                        onClick={handleOwnerAction}
                                        disabled={isUpdatingOwner}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                                    >
                                        {isUpdatingOwner ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                                        {isUpdatingOwner ? 'Sending...' : 'Send Reset Email'}
                                    </button>
                                </div>
                            )}

                            {manageOwnerModal.action === 'contact' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-medium text-ink-muted mb-1.5">Owner Email</label>
                                        <input
                                            type="email"
                                            value={manageOwnerModal.email || ''}
                                            onChange={(e) => setManageOwnerModal(prev => ({ ...prev, email: e.target.value }))}
                                            className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-ink-muted mb-1.5">Phone Number</label>
                                        <input
                                            type="tel"
                                            value={manageOwnerModal.phone || ''}
                                            onChange={(e) => setManageOwnerModal(prev => ({ ...prev, phone: e.target.value }))}
                                            placeholder="+977-98XXXXXXXX"
                                            className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                        />
                                    </div>
                                    <button
                                        onClick={handleOwnerAction}
                                        disabled={isUpdatingOwner}
                                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                                    >
                                        {isUpdatingOwner ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                        {isUpdatingOwner ? 'Updating...' : 'Save Changes'}
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="border-t border-hairline bg-surface-muted/70 px-6 py-4">
                            <button
                                onClick={() => setManageOwnerModal({ isOpen: false, restaurant: null, action: 'password' })}
                                className="w-full rounded-xl border border-hairline-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-surface-muted"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-3xl rounded-3xl bg-surface shadow-2xl border border-hairline-strong overflow-hidden">
                        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
                            <div>
                                <h3 className="text-xl font-semibold text-ink">Add Client</h3>
                                <p className="mt-1 text-sm text-ink-subtle">Create a new restaurant tenant, provision the manager account, and seed the default settings in one flow.</p>
                            </div>
                            <button
                                onClick={() => {
                                    if (!isCreatingTenant) {
                                        setIsCreateModalOpen(false)
                                    }
                                }}
                                className="rounded-lg p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink-muted"
                                aria-label="Close add client modal"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="grid gap-6 px-6 py-6 md:grid-cols-2">
                            <div className="space-y-4 rounded-2xl border border-hairline-strong bg-surface shadow-sm p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                                    <Store size={16} className="text-primary" />
                                    Restaurant Profile
                                </div>

                                <Field label="Restaurant name *" icon={<Store size={16} />}>
                                    <input
                                        value={createForm.restaurantName}
                                        onChange={(e) => handleCreateFormChange('restaurantName', e.target.value)}
                                        placeholder="Hotel Himalaya"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Restaurant slug *" icon={<Store size={16} />}>
                                    <input
                                        value={createForm.restaurantSlug}
                                        onChange={(e) => handleCreateFormChange('restaurantSlug', e.target.value)}
                                        placeholder="hotel-himalaya"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Contact phone" icon={<Phone size={16} />}>
                                    <input
                                        value={createForm.contactPhone}
                                        onChange={(e) => handleCreateFormChange('contactPhone', e.target.value)}
                                        placeholder="+977-98XXXXXXXX"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Address" icon={<MapPin size={16} />}>
                                    <textarea
                                        value={createForm.address}
                                        onChange={(e) => handleCreateFormChange('address', e.target.value)}
                                        placeholder="Kathmandu, Nepal"
                                        rows={3}
                                        className="w-full resize-none rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Subscription tier" icon={<Crown size={16} />}>
                                    <Select
                                        value={createForm.subscriptionTier}
                                        onChange={(e) => handleCreateFormChange('subscriptionTier', e.target.value)}
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    >
                                        {TIERS.map(t => (
                                            <option key={t} value={t}>{TIER_LABELS[t]}</option>
                                        ))}
                                    </Select>
                                </Field>

                                <Field label="Business type *" icon={<Building2 size={16} />}>
                                    <Select
                                        value={createForm.businessType}
                                        onChange={(e) => handleCreateFormChange('businessType', e.target.value)}
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    >
                                        <option value="Restaurant">Restaurant (Dine-in)</option>
                                        <option value="Resort/Hotel">Resort/Hotel (Hospitality & Room Billing)</option>
                                        <option value="Cafe">Cafe (Counter Service)</option>
                                        <option value="FastFood">Fast Food (Counter Service)</option>
                                        <option value="Bakery">Bakery (Counter Service)</option>
                                        <option value="Fine Dining">Fine Dining (Dine-in)</option>
                                        <option value="Bar">Bar (Bar Service)</option>
                                        <option value="Cloud Kitchen">Cloud Kitchen (Delivery Only)</option>
                                    </Select>
                                </Field>
                            </div>

                            <div className="space-y-4 rounded-2xl border border-hairline-strong bg-surface shadow-sm p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                                    <UserRound size={16} className="text-primary" />
                                    Owner Account
                                </div>

                                <Field label="Owner full name *" icon={<UserRound size={16} />}>
                                    <input
                                        value={createForm.ownerFullName}
                                        onChange={(e) => handleCreateFormChange('ownerFullName', e.target.value)}
                                        placeholder="Aarav Shrestha"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Owner email *" icon={<Mail size={16} />}>
                                    <input
                                        type="email"
                                        value={createForm.ownerEmail}
                                        onChange={(e) => handleCreateFormChange('ownerEmail', e.target.value)}
                                        placeholder="owner@hotelhimalaya.com"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <Field label="Temporary password *" icon={<KeyRound size={16} />}>
                                    <input
                                        type="password"
                                        value={createForm.ownerPassword}
                                        onChange={(e) => handleCreateFormChange('ownerPassword', e.target.value)}
                                        placeholder="Minimum 8 characters"
                                        className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                    />
                                </Field>

                                <div className="rounded-2xl border border-brand-200 bg-brand-50/50 p-4 text-sm text-orange-900">
                                    This creates the auth account, links the owner as the manager, and seeds default theme, tax, currency, and feature flags.
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-hairline bg-surface px-6 py-4 md:flex-row md:items-center md:justify-between">
                            <p className="text-xs text-ink-subtle">The new owner can sign in immediately with the email and temporary password above.</p>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        if (!isCreatingTenant) {
                                            resetCreateForm()
                                            setIsCreateModalOpen(false)
                                        }
                                    }}
                                    className="rounded-xl border border-hairline-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink-muted transition hover:bg-surface-muted"
                                    disabled={isCreatingTenant}
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleCreateTenant}
                                    disabled={isCreatingTenant}
                                    className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {isCreatingTenant ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                                    {isCreatingTenant ? 'Creating...' : 'Create Client'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Record Payment Modal */}
            {paymentModal.isOpen && paymentModal.restaurant && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-md">
                        <div className="p-6 border-b border-hairline flex items-center justify-between">
                            <div>
                                <h2 className="text-lg font-extrabold text-ink">Record Subscription Payment</h2>
                                <p className="text-sm text-ink-subtle mt-0.5">{paymentModal.restaurant.name}</p>
                            </div>
                            <button onClick={() => setPaymentModal({ isOpen: false, restaurant: null })} className="p-2 text-ink-subtle hover:text-ink-muted rounded-lg hover:bg-surface-muted">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1.5">Amount (Rs.)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    placeholder="e.g. 1999"
                                    value={paymentForm.amount}
                                    onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))}
                                    className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1.5">Payment Method</label>
                                <Select
                                    value={paymentForm.method}
                                    onChange={e => setPaymentForm(p => ({ ...p, method: e.target.value }))}
                                    className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                >
                                    <option value="cash">Cash</option>
                                    <option value="esewa">eSewa</option>
                                    <option value="khalti">Khalti</option>
                                    <option value="bank_transfer">Bank Transfer</option>
                                    <option value="fonepay">FonePay</option>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1.5">Reference / Transaction ID</label>
                                <input
                                    type="text"
                                    placeholder="Optional — transaction code"
                                    value={paymentForm.reference}
                                    onChange={e => setPaymentForm(p => ({ ...p, reference: e.target.value }))}
                                    className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-ink-muted mb-1.5">Notes</label>
                                <input
                                    type="text"
                                    placeholder="Optional"
                                    value={paymentForm.notes}
                                    onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))}
                                    className="w-full rounded-xl border border-hairline-strong bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                />
                            </div>
                        </div>
                        <div className="p-6 border-t border-hairline flex gap-3">
                            <button
                                onClick={() => setPaymentModal({ isOpen: false, restaurant: null })}
                                className="flex-1 py-2.5 rounded-xl border border-hairline-strong text-sm font-medium text-ink-muted hover:bg-surface-muted transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRecordPayment}
                                disabled={isRecordingPayment || !paymentForm.amount}
                                className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
                            >
                                {isRecordingPayment ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Record & Extend
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

function Field({
    label,
    icon,
    children,
}: {
    label: string
    icon: React.ReactNode
    children: React.ReactNode
}) {
    return (
        <label className="block space-y-1.5">
            <span className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                <span className="text-ink-subtle">{icon}</span>
                {label}
            </span>
            {children}
        </label>
    )
}

function MetricCard({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: React.ElementType
    label: string
    value: number | string
    color: 'indigo' | 'emerald' | 'blue' | 'purple' | 'amber' | 'red'
}) {
    const colors = {
        indigo: 'from-indigo-500 to-violet-500 text-indigo-500 bg-indigo-50',
        emerald: 'from-emerald-500 to-teal-500 text-emerald-500 bg-emerald-50',
        blue: 'from-blue-500 to-cyan-500 text-blue-500 bg-blue-50',
        purple: 'from-purple-500 to-fuchsia-500 text-purple-500 bg-purple-50',
        amber: 'from-amber-400 to-orange-500 text-amber-500 bg-amber-50',
        red: 'from-red-500 to-rose-500 text-red-500 bg-red-50',
    }
    const c = colors[color] || colors.indigo

    return (
        <div className="group relative bg-surface rounded-[24px] p-6 border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 hover:-translate-y-1 overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${c.split(' ')[0]} ${c.split(' ')[1]} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
            
            <div className="flex flex-col h-full justify-between">
                <div className={`w-12 h-12 rounded-[16px] flex items-center justify-center ${c.split(' ')[2]} ${c.split(' ')[3]} group-hover:scale-110 transition-transform duration-300 mb-4`}>
                    <Icon size={24} />
                </div>
                <div>
                    <h3 className="text-ink-subtle text-[13px] font-semibold uppercase tracking-wider mb-1">{label}</h3>
                    <p className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight tabular-nums truncate">
                        {typeof value === 'number' ? value.toLocaleString() : value}
                    </p>
                </div>
            </div>
        </div>
    )
}
