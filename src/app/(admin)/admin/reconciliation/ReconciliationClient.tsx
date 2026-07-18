'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { 
    Users, Link as LinkIcon, Link2Off, RefreshCw, Key, Shield, FileText, 
    ArrowUpRight, ArrowDownLeft, Landmark, DollarSign, Calendar, Clock, Lock,
    Check, X, Settings, ArrowRight, ToggleLeft, ToggleRight
} from 'lucide-react'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import Button from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'
import { 
    sendLinkRequestAction, 
    acceptLinkRequestAction, 
    rejectLinkRequestAction, 
    updateLinkSettingsAction 
} from './actions'

interface RestaurantOption {
    id: string
    name: string
    business_type: string
}

interface LinkRequest {
    id: string
    sender_id: string
    receiver_id: string
    status: string
    created_at: string
    sender?: {
        name: string
        business_type: string
    } | null
    receiver?: {
        name: string
        business_type: string
    } | null
}

export default function ReconciliationClient({
    restaurant,
    partner,
    allRestaurants = [],
    sentRequests = [],
    receivedRequests = [],
    payables,
    receivables,
    auditLogs
}: {
    restaurant: any
    partner: any
    allRestaurants?: RestaurantOption[]
    sentRequests?: LinkRequest[]
    receivedRequests?: LinkRequest[]
    payables: any[]
    receivables: any[]
    auditLogs: any[]
}) {
    const router = useRouter()
    const money = useCurrency()
    const supabase = createClient()
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
        
        // Load partner session from localStorage if present
        const savedToken = localStorage.getItem(`partner_session_token_${restaurant.id}`)
        const savedExpires = localStorage.getItem(`partner_session_expires_${restaurant.id}`)
        
        if (savedToken && savedExpires) {
            const expiresDate = new Date(savedExpires)
            if (expiresDate > new Date()) {
                setActiveSessionToken(savedToken)
                setSessionExpires(savedExpires)
                setLoadingPartnerData(true)
                fetchPartnerMetrics(savedToken).finally(() => {
                    setLoadingPartnerData(false)
                })
            } else {
                localStorage.removeItem(`partner_session_token_${restaurant.id}`)
                localStorage.removeItem(`partner_session_expires_${restaurant.id}`)
            }
        }
    }, [])

    // Link Request State
    const [selectedPartnerId, setSelectedPartnerId] = useState('')
    const [isRequesting, setIsRequesting] = useState(false)
    const [actioningId, setActioningId] = useState<string | null>(null)

    // Feature toggles
    const [allowFolio, setAllowFolio] = useState(restaurant.link_allow_folio_charges !== false)
    const [allowLoyalty, setAllowLoyalty] = useState(restaurant.link_allow_loyalty_sharing !== false)
    const [allowCredit, setAllowCredit] = useState(restaurant.link_allow_credit_sharing !== false)
    const [isSavingToggles, setIsSavingToggles] = useState(false)

    // Config options
    const [ledgerMode, setLedgerMode] = useState(restaurant.ledger_split_mode || 'direct')
    const [commissionRate, setCommissionRate] = useState((restaurant.billing_commission_rate ?? 0).toString())
    const [loadingConfig, setLoadingConfig] = useState(false)

    // Analytics state
    const [sharedAnalytics, setSharedAnalytics] = useState(!!restaurant.analytics_shared)
    const [newPin, setNewPin] = useState('')
    const [partnerPin, setPartnerPin] = useState('')
    const [loadingPin, setLoadingPin] = useState(false)
    const [activeSessionToken, setActiveSessionToken] = useState<string | null>(null)
    const [sessionExpires, setSessionExpires] = useState<string | null>(null)
    const [partnerData, setPartnerData] = useState<any | null>(null)
    const [loadingPartnerData, setLoadingPartnerData] = useState(false)

    // Sum totals
    const totalPayables = payables.reduce((acc, p) => acc + Number(p.amount), 0)
    const totalReceivables = receivables.reduce((acc, r) => acc + Number(r.amount), 0)
    const netBalance = totalReceivables - totalPayables

    // Handle Send Link Request
    const handleSendRequest = async () => {
        if (!selectedPartnerId) {
            toast.error('Please select a partner property.')
            return
        }
        if (selectedPartnerId === restaurant.id) {
            toast.error('You cannot link to your own property.')
            return
        }
        setIsRequesting(true)
        try {
            const res = await sendLinkRequestAction(selectedPartnerId)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Link request sent successfully!')
                setSelectedPartnerId('')
                router.refresh()
            }
        } catch {
            toast.error('Failed to send request.')
        } finally {
            setIsRequesting(false)
        }
    }

    // Handle Accept Request
    const handleAcceptRequest = async (id: string) => {
        setActioningId(id)
        try {
            const res = await acceptLinkRequestAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Link established successfully!')
                router.refresh()
            }
        } catch {
            toast.error('Failed to accept request.')
        } finally {
            setActioningId(null)
        }
    }

    // Handle Reject Request
    const handleRejectRequest = async (id: string) => {
        setActioningId(id)
        try {
            const res = await rejectLinkRequestAction(id)
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Link request rejected.')
                router.refresh()
            }
        } catch {
            toast.error('Failed to reject request.')
        } finally {
            setActioningId(null)
        }
    }

    // Handle Save Feature Toggles
    const handleSaveToggles = async (folio: boolean, loyalty: boolean, credit: boolean) => {
        setIsSavingToggles(true)
        try {
            const res = await updateLinkSettingsAction({ folio, loyalty, credit })
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Link feature toggles updated!')
                setAllowFolio(folio)
                setAllowLoyalty(loyalty)
                setAllowCredit(credit)
            }
        } catch {
            toast.error('Failed to save toggles.')
        } finally {
            setIsSavingToggles(false)
        }
    }

    // Settings handle
    const handleSaveConfig = async () => {
        setLoadingConfig(true)
        try {
            const { error } = await supabase
                .from('restaurants')
                .update({
                    ledger_split_mode: ledgerMode,
                    billing_commission_rate: Number(commissionRate) || 0
                })
                .eq('id', restaurant.id)

            if (error) throw error
            toast.success('Integration settings updated')
            router.refresh()
        } catch (err: any) {
            toast.error(err.message || 'Failed to update settings')
        } finally {
            setLoadingConfig(false)
        }
    }

    // Set PIN
    const handleSetPin = async () => {
        if (!newPin || !/^\d{6}$/.test(newPin)) {
            toast.error('PIN must be exactly 6 digits')
            return
        }
        setLoadingPin(true)
        try {
            const pinHash = btoa(newPin)
            const { error } = await supabase
                .from('restaurants')
                .update({ analytics_pin_hash: pinHash })
                .eq('id', restaurant.id)

            if (error) throw error
            toast.success('Security PIN set successfully!')
            setNewPin('')
        } catch (err: any) {
            toast.error(err.message || 'Failed to set PIN')
        } finally {
            setLoadingPin(false)
        }
    }

    // Toggle Shared Analytics
    const handleToggleShared = async (val: boolean) => {
        setSharedAnalytics(val)
        try {
            const { error } = await supabase
                .from('restaurants')
                .update({ analytics_shared: val })
                .eq('id', restaurant.id)
            if (error) throw error
            toast.success(val ? 'Partner analytics sharing enabled' : 'Partner analytics sharing disabled')
        } catch (err: any) {
            toast.error(err.message || 'Failed to toggle analytics setting')
            setSharedAnalytics(!val)
        }
    }

    // Authenticate Analytics
    const handleAuthAnalytics = async () => {
        if (!partnerPin || !/^\d{6}$/.test(partnerPin)) {
            toast.error('PIN must be exactly 6 digits')
            return
        }
        setLoadingPartnerData(true)
        try {
            const res = await fetch('/api/tenants/analytics/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: partnerPin })
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
            } else {
                setActiveSessionToken(data.sessionToken)
                setSessionExpires(data.expiresAt)
                localStorage.setItem(`partner_session_token_${restaurant.id}`, data.sessionToken)
                localStorage.setItem(`partner_session_expires_${restaurant.id}`, data.expiresAt)
                toast.success('Partner analytics session authorized!')
                await fetchPartnerMetrics(data.sessionToken)
            }
        } catch (err) {
            toast.error('Failed to authorize partner analytics')
        } finally {
            setLoadingPartnerData(false)
        }
    }

    async function fetchPartnerMetrics(token: string) {
        try {
            const res = await fetch('/api/tenants/analytics/metrics', {
                headers: { 'Authorization': `Bearer ${token}` }
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
                setActiveSessionToken(null)
                setSessionExpires(null)
                localStorage.removeItem(`partner_session_token_${restaurant.id}`)
                localStorage.removeItem(`partner_session_expires_${restaurant.id}`)
            } else {
                setPartnerData(data)
            }
        } catch (err) {
            toast.error('Failed to load partner financial metrics')
        }
    }

    const [loadingUnlink, setLoadingUnlink] = useState(false)
    const handleUnlink = async () => {
        if (!confirm('Are you sure you want to break the integration with your partner property? Historical invoice data will be preserved, but live syncing and order charging will stop.')) {
            return
        }
        setLoadingUnlink(true)
        try {
            const res = await fetch('/api/tenants/invitation/unlink', { method: 'POST' })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
            } else {
                localStorage.removeItem(`partner_session_token_${restaurant.id}`)
                localStorage.removeItem(`partner_session_expires_${restaurant.id}`)
                setActiveSessionToken(null)
                setSessionExpires(null)
                setPartnerData(null)
                toast.success('Partner property unlinked successfully')
                router.refresh()
            }
        } catch (err) {
            toast.error('Failed to unlink partner')
        } finally {
            setLoadingUnlink(false)
        }
    }

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-8 bg-surface text-ink min-h-screen">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-hairline pb-6">
                <div>
                    <h1 className="text-3xl font-extrabold tracking-tight">Cross-Tenant Integration Settings</h1>
                    <p className="text-ink-subtle mt-1 text-sm">
                        Configure direct restaurant checkout post to rooms, share loyalty ledgers, and synchronize credit balances between properties from a single computer panel.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {partner ? (
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-sm font-extrabold shadow-sm">
                                <Users className="w-4 h-4" />
                                <span>Linked to {partner.name} ({partner.business_type})</span>
                            </div>
                            <button
                                onClick={handleUnlink}
                                disabled={loadingUnlink}
                                className="px-3 py-2 border border-red-200 text-red-600 bg-red-50/50 hover:bg-red-50 hover:text-red-700 rounded-xl text-xs font-bold transition active:scale-95 flex items-center gap-1.5"
                            >
                                <Link2Off className="w-3.5 h-3.5" />
                                <span>{loadingUnlink ? 'Unlinking...' : 'Unlink Partner'}</span>
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 border border-amber-100 rounded-xl text-sm font-extrabold shadow-sm">
                            <Link2Off className="w-4 h-4 animate-pulse" />
                            <span>Standalone Mode (Unlinked)</span>
                        </div>
                    )}
                </div>
            </div>

            {/* If Unlinked: Setup direct one-computer linking */}
            {!partner ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Link Property Request */}
                    <div className="border border-hairline rounded-3xl p-6 bg-surface-muted/50 space-y-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <LinkIcon className="w-5 h-5 text-primary" />
                            <span>Link Partner Property</span>
                        </h2>
                        <p className="text-xs text-ink-subtle leading-relaxed">
                            To prevent unauthorized linking, enter your partner property's exact Tenant ID (UUID) below. You can find this ID in the partner's settings dashboard.
                        </p>
                        
                        <div className="p-3 bg-surface border border-hairline rounded-2xl">
                            <span className="block text-[10px] text-ink-subtle font-extrabold uppercase">Your Property Tenant ID:</span>
                            <code className="block text-xs font-mono font-bold text-gray-700 select-all mt-1 bg-surface-muted p-2.5 rounded-xl border border-hairline break-all">
                                {restaurant.id}
                            </code>
                            <span className="block text-[9px] text-ink-subtle font-semibold mt-1">Copy and share this ID with your partner property to establish a connection.</span>
                        </div>

                        <div className="space-y-3 pt-2">
                            <div>
                                <label className="block text-xs font-extrabold mb-1">Partner Property Tenant ID (UUID) *</label>
                                <input 
                                    type="text"
                                    value={selectedPartnerId}
                                    onChange={(e) => setSelectedPartnerId(e.target.value.trim())}
                                    placeholder="Enter 36-character partner UUID..."
                                    className="w-full px-4 py-3 bg-surface border border-hairline rounded-2xl text-xs font-mono font-bold outline-none focus:border-primary transition"
                                />
                                {selectedPartnerId === restaurant.id && (
                                    <span className="text-[10px] text-red-500 font-semibold block mt-1">You cannot link to your own property.</span>
                                )}
                            </div>
                            <Button 
                                onClick={handleSendRequest}
                                disabled={isRequesting || !selectedPartnerId || selectedPartnerId.length < 32}
                                className="w-full flex items-center justify-center gap-2 font-bold"
                            >
                                {isRequesting ? 'Sending...' : 'Send Link Request'}
                            </Button>
                        </div>

                        {sentRequests.length > 0 && (
                            <div className="mt-4 border-t border-hairline pt-4 space-y-2">
                                <span className="block text-xs font-bold text-ink-subtle">Outgoing Requests:</span>
                                {sentRequests.map(req => (
                                    <div key={req.id} className="p-3 bg-surface border border-hairline rounded-2xl flex items-center justify-between text-xs font-bold">
                                        <span>Sent to {req.receiver?.name}</span>
                                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] uppercase">Pending</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Incoming Requests Handshake (Allows instant one-click approval on one computer) */}
                    <div className="border border-hairline rounded-3xl p-6 bg-surface-muted/50 space-y-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            <span>Incoming Link Requests</span>
                        </h2>
                        <p className="text-xs text-ink-subtle leading-relaxed">
                            Approve or reject linking requests from partner properties operating on this device. Accepting establishes the link instantly.
                        </p>
                        
                        <div className="space-y-3 pt-2">
                            {receivedRequests.length === 0 ? (
                                <div className="p-8 text-center border border-dashed border-hairline rounded-2xl text-xs text-ink-subtle font-medium">
                                    No incoming requests. Select your partner property on the left to initiate.
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {receivedRequests.map(req => (
                                        <div key={req.id} className="p-4 bg-surface border border-hairline rounded-2xl flex items-center justify-between">
                                            <div>
                                                <p className="text-sm font-bold text-gray-900">{req.sender?.name}</p>
                                                <p className="text-[10px] text-ink-subtle uppercase tracking-wider font-semibold mt-0.5">{req.sender?.business_type}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleRejectRequest(req.id)}
                                                    disabled={actioningId !== null}
                                                    className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl transition"
                                                >
                                                    <X size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleAcceptRequest(req.id)}
                                                    disabled={actioningId !== null}
                                                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition flex items-center gap-1"
                                                >
                                                    <Check size={14} />
                                                    Approve
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                /* If Linked: Show settings, feature toggles and split ledgers */
                <div className="space-y-8">
                    {/* Settings & Configuration Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Options Split settings */}
                        <div className="border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Landmark className="w-5 h-5 text-primary" />
                                <span>Ledger Split Mode</span>
                            </h2>
                            <p className="text-xs text-ink-subtle">
                                Choose how restaurant food bills are split and credited when checked out by the hotel.
                            </p>
                            <div className="space-y-3 pt-2">
                                <label className="flex items-start gap-3 p-3 border border-hairline rounded-2xl cursor-pointer hover:bg-surface-muted/30 transition">
                                    <input 
                                        type="radio" 
                                        name="split_mode" 
                                        value="direct"
                                        checked={ledgerMode === 'direct'}
                                        onChange={() => setLedgerMode('direct')}
                                        className="mt-1"
                                    />
                                    <div>
                                        <span className="block text-xs font-extrabold">Option A: Direct Split</span>
                                        <span className="block text-[10px] text-ink-subtle mt-0.5 leading-normal">
                                            Food orders placed from hotel rooms are credited directly to the restaurant's PAN and ledger as immediate revenue.
                                        </span>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 p-3 border border-hairline rounded-2xl cursor-pointer hover:bg-surface-muted/30 transition">
                                    <input 
                                        type="radio" 
                                        name="split_mode" 
                                        value="b2b"
                                        checked={ledgerMode === 'b2b'}
                                        onChange={() => setLedgerMode('b2b')}
                                        className="mt-1"
                                    />
                                    <div>
                                        <span className="block text-xs font-extrabold">Option B: B2B Transfer</span>
                                        <span className="block text-[10px] text-ink-subtle mt-0.5 leading-normal">
                                            Entire payment is billed to Hotel invoice. Creates internal Accounts Payable (Hotel) and Accounts Receivable (Restaurant) ledgers.
                                        </span>
                                    </div>
                                </label>
                                {ledgerMode === 'b2b' && (
                                    <div>
                                        <label className="block text-xs font-extrabold mb-1">Partner Commission Rate (%)</label>
                                        <input 
                                            type="number" 
                                            step="0.01"
                                            value={commissionRate}
                                            onChange={(e) => setCommissionRate(e.target.value)}
                                            placeholder="5.00"
                                            className="w-full px-3 py-2 bg-surface border border-hairline rounded-xl text-xs outline-none focus:border-primary"
                                        />
                                        <span className="text-[10px] text-ink-subtle leading-normal mt-1 block">
                                            Hotel earns this commission percentage on food orders. Restaurant gets net amount.
                                        </span>
                                    </div>
                                )}
                                <Button 
                                    onClick={handleSaveConfig}
                                    disabled={loadingConfig}
                                    className="w-full mt-2"
                                >
                                    {loadingConfig ? 'Saving...' : 'Update Settings'}
                                </Button>
                            </div>
                        </div>

                        {/* Feature Link Controls */}
                        <div className="border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm flex flex-col justify-between">
                            <div className="space-y-4">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Settings className="w-5 h-5 text-primary" />
                                    <span>Enabled Shared Features</span>
                                </h2>
                                <p className="text-xs text-ink-subtle">
                                    Control which customer-facing features are synchronized or linkable between the properties.
                                </p>
                                <div className="space-y-4 pt-2">
                                    <label className="flex items-center justify-between p-3 border border-hairline rounded-2xl cursor-pointer hover:bg-surface-muted/30 transition">
                                        <div className="pr-4">
                                            <span className="block text-xs font-extrabold">Room Folio Charges</span>
                                            <span className="block text-[9px] text-ink-subtle mt-0.5 leading-normal">
                                                Allow restaurant customers to post their dine-in food bills to hotel room invoices.
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => handleSaveToggles(!allowFolio, allowLoyalty, allowCredit)}
                                            disabled={isSavingToggles}
                                            className="text-[#ff5a00]"
                                        >
                                            {allowFolio ? <ToggleRight size={32} /> : <ToggleLeft className="text-gray-300" size={32} />}
                                        </button>
                                    </label>

                                    <label className="flex items-center justify-between p-3 border border-hairline rounded-2xl cursor-pointer hover:bg-surface-muted/30 transition">
                                        <div className="pr-4">
                                            <span className="block text-xs font-extrabold">Loyalty Points Sharing</span>
                                            <span className="block text-[9px] text-ink-subtle mt-0.5 leading-normal">
                                                Share customer rewards point balances and ledger tracking between properties.
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => handleSaveToggles(allowFolio, !allowLoyalty, allowCredit)}
                                            disabled={isSavingToggles}
                                            className="text-[#ff5a00]"
                                        >
                                            {allowLoyalty ? <ToggleRight size={32} /> : <ToggleLeft className="text-gray-300" size={32} />}
                                        </button>
                                    </label>

                                    <label className="flex items-center justify-between p-3 border border-hairline rounded-2xl cursor-pointer hover:bg-surface-muted/30 transition">
                                        <div className="pr-4">
                                            <span className="block text-xs font-extrabold">Receivable Credit accounts</span>
                                            <span className="block text-[9px] text-ink-subtle mt-0.5 leading-normal">
                                                Share customer ledger credit limits and profile details between properties.
                                            </span>
                                        </div>
                                        <button 
                                            onClick={() => handleSaveToggles(allowFolio, allowLoyalty, !allowCredit)}
                                            disabled={isSavingToggles}
                                            className="text-[#ff5a00]"
                                        >
                                            {allowCredit ? <ToggleRight size={32} /> : <ToggleLeft className="text-gray-300" size={32} />}
                                        </button>
                                    </label>
                                </div>
                            </div>
                        </div>

                        {/* PIN Settings */}
                        <div className="border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Key className="w-5 h-5 text-primary" />
                                <span>Security Analytics PIN</span>
                            </h2>
                            <p className="text-xs text-ink-subtle">
                                Set a numeric security PIN to encrypt cross-tenant analytics access.
                            </p>
                            <div className="space-y-3 pt-2">
                                <div>
                                    <label className="block text-xs font-extrabold mb-1">New 6-Digit PIN</label>
                                    <input 
                                        type="password" 
                                        maxLength={6}
                                        value={newPin}
                                        onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                                        placeholder="******"
                                        className="w-full px-3 py-2 bg-surface border border-hairline rounded-xl text-xs outline-none focus:border-primary font-mono tracking-widest text-center"
                                    />
                                </div>
                                <Button 
                                    onClick={handleSetPin}
                                    disabled={loadingPin}
                                    className="w-full mt-2"
                                >
                                    {loadingPin ? 'Updating PIN...' : 'Set Security PIN'}
                                </Button>

                                <div className="border-t border-hairline pt-4 space-y-2">
                                    <label className="flex items-center justify-between cursor-pointer">
                                        <div>
                                            <span className="block text-xs font-extrabold">Enable Sharing</span>
                                            <span className="block text-[9px] text-ink-subtle leading-normal">Allow partner to view analytics with PIN.</span>
                                        </div>
                                        <input 
                                            type="checkbox" 
                                            checked={sharedAnalytics}
                                            onChange={(e) => handleToggleShared(e.target.checked)}
                                            className="rounded border-hairline text-primary focus:ring-primary"
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Active Link Financial Dashboard & Split Ledger Reports */}
                    {ledgerMode === 'b2b' && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Summary Card */}
                            <div className="border border-hairline rounded-3xl p-6 bg-surface-muted/30 space-y-4">
                                <h3 className="text-lg font-extrabold">B2B Monthly Settlement Summary</h3>
                                <p className="text-xs text-ink-subtle">
                                    Overview of outstanding payables and receivables with your partner property.
                                </p>
                                <div className="grid grid-cols-2 gap-4 pt-2">
                                    <div className="p-4 bg-surface border border-hairline rounded-2xl">
                                        <span className="block text-[10px] text-ink-subtle font-extrabold uppercase">Receivables</span>
                                        <span className="block text-lg font-black text-emerald-600 mt-1">{money(totalReceivables)}</span>
                                    </div>
                                    <div className="p-4 bg-surface border border-hairline rounded-2xl">
                                        <span className="block text-[10px] text-ink-subtle font-extrabold uppercase">Payables</span>
                                        <span className="block text-lg font-black text-rose-600 mt-1">{money(totalPayables)}</span>
                                    </div>
                                </div>
                                <div className="p-4 bg-surface border border-hairline rounded-2xl flex items-center justify-between">
                                    <div>
                                        <span className="block text-[10px] text-ink-subtle font-extrabold uppercase">Net Balance</span>
                                        <span className={`block text-xl font-black mt-1 ${netBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {netBalance >= 0 ? '+' : ''}{money(netBalance)}
                                        </span>
                                    </div>
                                    <span className="text-[10px] text-ink-subtle font-extrabold max-w-[120px] text-right leading-snug">
                                        {netBalance >= 0 ? 'Partner owes you this amount' : 'You owe partner this amount'}
                                    </span>
                                </div>
                            </div>

                            {/* Detailed Ledger list */}
                            <div className="lg:col-span-2 border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm">
                                <h3 className="text-lg font-bold flex items-center gap-2">
                                    <FileText className="w-5 h-5 text-primary" />
                                    <span>B2B Settlement Transactions Ledger</span>
                                </h3>
                                <div className="overflow-y-auto max-h-[220px] scrollbar-none pr-1">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-hairline text-ink-subtle font-extrabold">
                                                <th className="py-2.5">Date</th>
                                                <th className="py-2.5">Transaction Type</th>
                                                <th className="py-2.5">Description</th>
                                                <th className="py-2.5 text-right">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {/* Receivables (Income categories Accounts Receivable) */}
                                            {receivables.map((r) => (
                                                <tr key={r.id} className="border-b border-hairline hover:bg-surface-muted/20">
                                                    <td className="py-2.5">{mounted ? new Date(r.created_at).toLocaleDateString() : ''}</td>
                                                    <td className="py-2.5 text-emerald-600 font-bold flex items-center gap-1">
                                                        <ArrowDownLeft className="w-3.5 h-3.5" />
                                                        <span>Accounts Receivable</span>
                                                    </td>
                                                    <td className="py-2.5 text-ink-subtle">{r.description}</td>
                                                    <td className="py-2.5 text-right font-extrabold text-emerald-700">+{money(Number(r.amount))}</td>
                                                </tr>
                                            ))}
                                            {/* Payables (Expenses category Accounts Payable) */}
                                            {payables.map((p) => (
                                                <tr key={p.id} className="border-b border-hairline hover:bg-surface-muted/20">
                                                    <td className="py-2.5">{mounted ? new Date(p.created_at).toLocaleDateString() : ''}</td>
                                                    <td className="py-2.5 text-rose-600 font-bold flex items-center gap-1">
                                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                                        <span>Accounts Payable</span>
                                                    </td>
                                                    <td className="py-2.5 text-ink-subtle">{p.description}</td>
                                                    <td className="py-2.5 text-right font-extrabold text-rose-700">-{money(Number(p.amount))}</td>
                                                </tr>
                                            ))}
                                            {receivables.length === 0 && payables.length === 0 && (
                                                <tr>
                                                    <td colSpan={4} className="py-8 text-center text-ink-subtle font-medium">No B2B monthly ledger transactions found.</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Immutable Access Audit Logs */}
                    <div className="border border-hairline rounded-3xl p-6 bg-surface shadow-sm space-y-4">
                        <h3 className="text-lg font-bold flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            <span>Security PIN Access Audit Logs (Immutable)</span>
                        </h3>
                        <p className="text-xs text-ink-subtle">
                            Real-time tracking of PIN checks, analytics access sessions, and failed authorization attempts.
                        </p>
                        <div className="overflow-x-auto pt-2">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="border-b border-hairline text-ink-subtle font-extrabold">
                                        <th className="py-2">Timestamp</th>
                                        <th className="py-2">Action</th>
                                        <th className="py-2">Logs & Trace Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {auditLogs.map((log) => (
                                        <tr key={log.id} className="border-b border-hairline">
                                            <td className="py-2.5 text-ink-subtle">{mounted ? new Date(log.created_at).toLocaleString() : ''}</td>
                                            <td className={`py-2.5 font-extrabold ${log.action === 'analytics_accessed' ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                {log.action === 'analytics_accessed' ? 'Access Granted' : 'Access Failed'}
                                            </td>
                                            <td className="py-2.5 text-ink-subtle">{log.details}</td>
                                        </tr>
                                    ))}
                                    {auditLogs.length === 0 && (
                                        <tr>
                                            <td colSpan={3} className="py-4 text-center text-ink-subtle font-medium">No audit logs recorded yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
