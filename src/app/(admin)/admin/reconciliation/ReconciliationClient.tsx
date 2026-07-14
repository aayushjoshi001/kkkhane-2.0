'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { 
    Users, Link, Link2Off, RefreshCw, Key, Shield, FileText, 
    ArrowUpRight, ArrowDownLeft, Landmark, DollarSign, Calendar, Clock, Lock
} from 'lucide-react'
import { useCurrency } from '@/lib/contexts/FeatureContext'
import Button from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

export default function ReconciliationClient({
    restaurant,
    partner,
    payables,
    receivables,
    auditLogs
}: {
    restaurant: any
    partner: any
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
    }, [])

    // Invites state
    const [recipientEmail, setRecipientEmail] = useState('')
    const [generatedToken, setGeneratedToken] = useState('')
    const [acceptToken, setAcceptToken] = useState('')
    const [loadingInvite, setLoadingInvite] = useState(false)

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
    const netBalance = totalReceivables - totalPayables // positive means partner owes us, negative means we owe partner

    // Invite handle
    const handleGenerateInvite = async () => {
        if (!recipientEmail) {
            toast.error('Please enter a recipient email')
            return
        }
        setLoadingInvite(true)
        try {
            const res = await fetch('/api/tenants/invitation/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ recipientEmail })
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
            } else {
                setGeneratedToken(data.token)
                toast.success('Invitation token generated! Copy it below.')
            }
        } catch (err) {
            toast.error('Failed to generate invitation')
        } finally {
            setLoadingInvite(false)
        }
    }

    const handleAcceptInvite = async () => {
        if (!acceptToken) {
            toast.error('Please paste a token')
            return
        }
        setLoadingInvite(true)
        try {
            const res = await fetch('/api/tenants/invitation/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: acceptToken })
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
            } else {
                toast.success('Handshake accepted! tenants linked successfully.')
                router.refresh()
            }
        } catch (err) {
            toast.error('Failed to accept invitation')
        } finally {
            setLoadingInvite(false)
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
            const res = await fetch('/api/tenants/analytics/pin/set', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: newPin })
            })
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
            } else {
                toast.success('Analytics PIN updated')
                setNewPin('')
                router.refresh()
            }
        } catch (err) {
            toast.error('Failed to save PIN')
        } finally {
            setLoadingPin(false)
        }
    }

    // Auth Partner Analytics
    const handleAuthPartner = async () => {
        if (!partnerPin) {
            toast.error('Please enter the partner PIN')
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
                toast.success('PIN Verified! Loading metrics...')
                setActiveSessionToken(data.token)
                setSessionExpires(data.expiresAt)
                fetchPartnerPnl(data.token)
            }
        } catch (err) {
            toast.error('Authorization failed')
        } finally {
            setLoadingPartnerData(false)
        }
    }

    const fetchPartnerPnl = async (token: string) => {
        try {
            const res = await fetch(`/api/tenants/analytics/pnl?token=${token}`)
            const data = await res.json()
            if (data.error) {
                toast.error(data.error)
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
                        Manage secure hotel-restaurant cryptographic invites, real-time table sync options, B2B ledger configuration, and PIN-authorized cross-analytics.
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

            {/* If Unlinked: Setup Invites */}
            {!partner ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Send Invite */}
                    <div className="border border-hairline rounded-3xl p-6 bg-surface-muted/50 space-y-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Link className="w-5 h-5 text-primary" />
                            <span>Generate Link Invitation</span>
                        </h2>
                        <p className="text-xs text-ink-subtle leading-relaxed">
                            Generate a cryptographically signed, secure invitation URL that contains your unique tenant ID and signature. This link strictly expires after **15 minutes**.
                        </p>
                        <div className="space-y-3 pt-2">
                            <div>
                                <label className="block text-xs font-extrabold mb-1">Partner Email Address</label>
                                <input 
                                    type="email" 
                                    value={recipientEmail}
                                    onChange={(e) => setRecipientEmail(e.target.value)}
                                    placeholder="manager@partnerproperty.com"
                                    className="w-full px-4 py-3 bg-surface border border-hairline rounded-2xl text-sm outline-none focus:border-primary transition"
                                />
                            </div>
                            <Button 
                                onClick={handleGenerateInvite}
                                disabled={loadingInvite}
                                className="w-full flex items-center justify-center gap-2"
                            >
                                {loadingInvite ? 'Generating...' : 'Generate Secure Invitation'}
                            </Button>
                        </div>
                        {generatedToken && (
                            <div className="mt-4 p-3 bg-surface border border-hairline rounded-2xl space-y-2">
                                <span className="block text-xs font-bold text-ink-subtle">Copy Token:</span>
                                <textarea
                                    readOnly
                                    value={generatedToken}
                                    onClick={(e) => {
                                        navigator.clipboard.writeText(generatedToken)
                                        toast.success('Token copied!')
                                    }}
                                    className="w-full h-24 p-2 bg-surface-muted text-xs border border-hairline rounded-xl outline-none cursor-pointer"
                                />
                                <span className="block text-[10px] text-amber-600 font-medium">Click box to copy token. Share this secretly with the partner.</span>
                            </div>
                        )}
                    </div>

                    {/* Accept Invite */}
                    <div className="border border-hairline rounded-3xl p-6 bg-surface-muted/50 space-y-4">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Users className="w-5 h-5 text-primary" />
                            <span>Accept Partner Invitation</span>
                        </h2>
                        <p className="text-xs text-ink-subtle leading-relaxed">
                            Paste the encrypted Base64 invitation token shared by the partner. The system will perform a bidirectional cryptographic handshake to link your accounts.
                        </p>
                        <div className="space-y-3 pt-2">
                            <div>
                                <label className="block text-xs font-extrabold mb-1">Paste Token Here</label>
                                <textarea
                                    value={acceptToken}
                                    onChange={(e) => setAcceptToken(e.target.value)}
                                    placeholder="eyJhbGciOi..."
                                    className="w-full h-24 p-3 bg-surface border border-hairline rounded-2xl text-sm outline-none focus:border-primary transition"
                                />
                            </div>
                            <Button 
                                onClick={handleAcceptInvite}
                                disabled={loadingInvite}
                                className="w-full"
                            >
                                {loadingInvite ? 'Verifying handshake...' : 'Accept Invite & Handshake'}
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                /* If Linked: Show settings and split ledgers */
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

                        {/* PIN Settings */}
                        <div className="border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Key className="w-5 h-5 text-primary" />
                                <span>Security Analytics PIN</span>
                            </h2>
                            <p className="text-xs text-ink-subtle">
                                Set a unique 6-digit PIN to securely authorize cross-tenant financial analytics viewing.
                            </p>
                            <div className="space-y-3 pt-2">
                                <div className="flex items-center justify-between border-b border-hairline pb-2 mb-2">
                                    <span className="text-xs font-bold">Sharing Enabled</span>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${sharedAnalytics ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                        {sharedAnalytics ? 'Yes' : 'No'}
                                    </span>
                                </div>
                                <div>
                                    <label className="block text-xs font-extrabold mb-1">Set 6-Digit PIN</label>
                                    <input 
                                        type="password" 
                                        maxLength={6}
                                        value={newPin}
                                        onChange={(e) => setNewPin(e.target.value)}
                                        placeholder="••••••"
                                        className="w-full px-3 py-2 bg-surface border border-hairline rounded-xl text-sm tracking-widest outline-none focus:border-primary"
                                    />
                                </div>
                                <Button 
                                    onClick={handleSetPin}
                                    disabled={loadingPin}
                                    className="w-full"
                                >
                                    {loadingPin ? 'Updating...' : 'Save Analytics PIN'}
                                </Button>
                            </div>
                        </div>

                        {/* PIN Analytics Access */}
                        <div className="border border-hairline rounded-3xl p-6 bg-surface space-y-4 shadow-sm">
                            <h2 className="text-lg font-bold flex items-center gap-2">
                                <Shield className="w-5 h-5 text-primary" />
                                <span>Access Partner P&L</span>
                            </h2>
                            <p className="text-xs text-ink-subtle">
                                Input the partner's security PIN to unlock their financial metrics for exactly **10 minutes**.
                            </p>
                            <div className="space-y-3 pt-2">
                                <div>
                                    <label className="block text-xs font-extrabold mb-1">Enter Partner PIN</label>
                                    <input 
                                        type="password" 
                                        maxLength={6}
                                        value={partnerPin}
                                        onChange={(e) => setPartnerPin(e.target.value)}
                                        placeholder="••••••"
                                        className="w-full px-3 py-2 bg-surface border border-hairline rounded-xl text-sm tracking-widest outline-none focus:border-primary"
                                    />
                                </div>
                                <Button 
                                    onClick={handleAuthPartner}
                                    disabled={loadingPartnerData}
                                    className="w-full"
                                >
                                    {loadingPartnerData ? 'Authorizing PIN...' : 'Verify & Access Analytics'}
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Partner analytics view (if active) */}
                    {partnerData && (
                        <div className="border border-emerald-200 rounded-3xl p-6 bg-emerald-50/10 space-y-4 shadow-sm">
                            <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
                                <h3 className="text-lg font-extrabold text-emerald-800 flex items-center gap-2">
                                    <Lock className="w-5 h-5" />
                                    <span>Financial P&L for Partner: {partnerData.partner.name}</span>
                                </h3>
                                <div className="text-xs text-amber-700 flex items-center gap-1">
                                    <Clock className="w-3.5 h-3.5" />
                                    <span>Session ends at: {mounted ? new Date(sessionExpires!).toLocaleTimeString() : ''}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                                <div className="bg-surface border border-hairline p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <span className="block text-xs font-bold text-ink-subtle">Total Income</span>
                                        <span className="block text-lg font-extrabold mt-1 text-emerald-600">{money(partnerData.totalIncome)}</span>
                                    </div>
                                    <ArrowDownLeft className="w-8 h-8 text-emerald-500 bg-emerald-50 p-1.5 rounded-full" />
                                </div>
                                <div className="bg-surface border border-hairline p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <span className="block text-xs font-bold text-ink-subtle">Total Expense</span>
                                        <span className="block text-lg font-extrabold mt-1 text-rose-600">{money(partnerData.totalExpense)}</span>
                                    </div>
                                    <ArrowUpRight className="w-8 h-8 text-rose-500 bg-rose-50 p-1.5 rounded-full" />
                                </div>
                                <div className="bg-surface border border-hairline p-4 rounded-2xl flex items-center justify-between">
                                    <div>
                                        <span className="block text-xs font-bold text-ink-subtle">Net Profit</span>
                                        <span className={`block text-lg font-extrabold mt-1 ${partnerData.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                            {money(partnerData.netProfit)}
                                        </span>
                                    </div>
                                    <Landmark className="w-8 h-8 text-primary bg-primary/5 p-1.5 rounded-full" />
                                </div>
                            </div>

                            {/* Categorized splits */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div className="bg-surface border border-hairline p-4 rounded-2xl">
                                    <h4 className="text-sm font-extrabold border-b border-hairline pb-2 mb-2">Income Categories</h4>
                                    <div className="space-y-2">
                                        {partnerData.incomeByCategory.length > 0 ? partnerData.incomeByCategory.map((c: any) => (
                                            <div key={c.name} className="flex justify-between text-xs">
                                                <span>{c.name}</span>
                                                <span className="font-bold">{money(c.amount)}</span>
                                            </div>
                                        )) : <span className="text-xs text-ink-subtle">No income logged.</span>}
                                    </div>
                                </div>
                                <div className="bg-surface border border-hairline p-4 rounded-2xl">
                                    <h4 className="text-sm font-extrabold border-b border-hairline pb-2 mb-2">Expense Categories</h4>
                                    <div className="space-y-2">
                                        {partnerData.expenseByCategory.length > 0 ? partnerData.expenseByCategory.map((c: any) => (
                                            <div key={c.name} className="flex justify-between text-xs">
                                                <span>{c.name}</span>
                                                <span className="font-bold">{money(c.amount)}</span>
                                            </div>
                                        )) : <span className="text-xs text-ink-subtle">No expenses logged.</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* B2B monthly reconciliation report */}
                    {ledgerMode === 'b2b' && (
                        <div className="border border-hairline rounded-3xl p-6 bg-surface shadow-sm space-y-6">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-hairline pb-4">
                                <div>
                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-primary" />
                                        <span>B2B Monthly Reconciliation Statement</span>
                                    </h3>
                                    <p className="text-xs text-ink-subtle mt-0.5">
                                        Authoritative reconciliation summary of Accounts Receivable and Accounts Payable transactions.
                                    </p>
                                </div>
                                <button
                                    onClick={() => window.print()}
                                    className="px-4 py-2 border border-hairline rounded-xl text-xs font-extrabold shadow-sm bg-surface hover:bg-surface-muted transition active:scale-95 flex items-center gap-2"
                                >
                                    <FileText className="w-4 h-4" />
                                    <span>Print Statement / PDF</span>
                                </button>
                            </div>

                            {/* Summary Totals */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="p-4 bg-surface-muted/30 border border-hairline rounded-2xl">
                                    <span className="text-xs text-ink-subtle font-bold">Total Accounts Receivable</span>
                                    <span className="block text-xl font-extrabold mt-1 text-emerald-700">{money(totalReceivables)}</span>
                                    <span className="text-[10px] text-ink-subtle mt-1 block">Revenue you are waiting to collect from Hotel</span>
                                </div>
                                <div className="p-4 bg-surface-muted/30 border border-hairline rounded-2xl">
                                    <span className="text-xs text-ink-subtle font-bold">Total Accounts Payable</span>
                                    <span className="block text-xl font-extrabold mt-1 text-rose-700">{money(totalPayables)}</span>
                                    <span className="text-[10px] text-ink-subtle mt-1 block">Revenue you owe to Restaurant</span>
                                </div>
                                <div className="p-4 bg-surface-muted/30 border border-hairline rounded-2xl">
                                    <span className="text-xs text-ink-subtle font-bold">Net Settlement Due</span>
                                    <span className={`block text-xl font-extrabold mt-1 ${netBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                        {netBalance >= 0 ? '+' : '-'}{money(Math.abs(netBalance))}
                                    </span>
                                    <span className="text-[10px] text-ink-subtle mt-1 block">
                                        {netBalance >= 0 ? 'Hotel owes this net total to Restaurant' : 'Restaurant owes this net total to Hotel'}
                                    </span>
                                </div>
                            </div>

                            {/* Detailed transaction entries */}
                            <div className="space-y-4">
                                <h4 className="text-sm font-extrabold border-b border-hairline pb-2">B2B Financial Ledger Audit Trails</h4>
                                <div className="overflow-x-auto">
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
