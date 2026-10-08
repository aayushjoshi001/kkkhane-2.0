import { requireRole } from '@/lib/auth'
import AdManager from './AdManager'
import { Settings, CheckCircle, XCircle, Shield, Zap, AlertTriangle, ExternalLink, Copy } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'
import { TIER_FEATURES, TIER_LIMITS, TIERS, TIER_LABELS, isUnlimited, type Tier } from '@/lib/tiers'
import GatewayCallbackCopy from './GatewayCallbackCopy'

export const dynamic = 'force-dynamic'

const FEATURE_LABELS: Record<string, string> = {
    loyaltyEnabled: 'Loyalty Program',
    promosEnabled: 'Promo Codes',
    takeoutEnabled: 'Takeout Orders',
    multiLanguageEnabled: 'Multi-Language',
    serviceRequestsEnabled: 'Service Requests',
    splitBillingEnabled: 'Split Billing',
    dynamicPricingEnabled: 'Dynamic Pricing',
    ingredientTrackingEnabled: 'Ingredient Tracking',
    staffShiftsEnabled: 'Staff Shifts',
    waiterSessionEnabled: 'Waiter-Opened Sessions',
    waiterOrderConfirmation: 'Waiter Order Confirmation',
}

const TIER_STYLE: Record<Tier, string> = {
    free: 'bg-surface-muted text-ink-muted border-hairline-strong',
    basic: 'bg-blue-50 text-blue-700 border-blue-200',
    premium: 'bg-purple-50 text-purple-700 border-purple-200',
    platinum: 'bg-slate-100 text-slate-800 border-slate-300',
    enterprise: 'bg-amber-50 text-amber-700 border-amber-200',
}

const DEFAULT_PLATFORM = {
    defaultTaxRate: 13,
    currency: 'NPR',
    currencySymbol: 'Rs.',
    nepalPayEnabled: true,
    vatEnabled: false,
}

// Reads env vars server-side to determine gateway status.
// Never exposes the key value itself — only presence and mode.
function gatewayStatus(envKey: string, testPrefix: string) {
    const val = process.env[envKey] ?? ''
    if (!val) return 'unconfigured' as const
    if (val.startsWith(testPrefix) || val === 'EPAYTEST' || val === 'TEST_MERCHANT') return 'test' as const
    return 'live' as const
}

export default async function ConfigPage() {
    await requireRole('super_admin')

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://your-domain.com'

    const gateways = [
        {
            id:        'esewa',
            name:      'eSewa',
            color:     '#60BB46',
            status:    gatewayStatus('ESEWA_PRODUCT_CODE', 'EPAYTEST'),
            envVars:   ['ESEWA_PRODUCT_CODE', 'ESEWA_SECRET_KEY'],
            callbackUrl: `${appUrl}/api/payments/esewa/callback`,
            docsUrl:   'https://developer.esewa.com.np/',
            dashUrl:   'https://merchant.esewa.com.np/',
            setupSteps: [
                'Register at merchant.esewa.com.np → "New Merchant"',
                'Complete KYC (citizenship + company docs)',
                'Get PRODUCT_CODE (e.g. ABCD1234) and SECRET_KEY from Integration tab',
                'Add callback URL in the Merchant Dashboard → Callback Settings',
                'Set ESEWA_PRODUCT_CODE and ESEWA_SECRET_KEY in Vercel env vars',
            ],
        },
        {
            id:        'khalti',
            name:      'Khalti',
            color:     '#5C2D91',
            status:    gatewayStatus('KHALTI_SECRET_KEY', 'test_secret_key_'),
            envVars:   ['KHALTI_SECRET_KEY'],
            callbackUrl: `${appUrl}/api/payments/khalti/callback`,
            docsUrl:   'https://docs.khalti.com/',
            dashUrl:   'https://admin.khalti.com/',
            setupSteps: [
                'Register at khalti.com → Business Account',
                'Verify business (PAN + company registration)',
                'Go to admin.khalti.com → API Keys',
                'Copy the Live Secret Key (starts with live_secret_key_)',
                'Set KHALTI_SECRET_KEY in Vercel env vars',
            ],
        },
        {
            id:        'fonepay',
            name:      'FonePay',
            color:     '#1565C0',
            status:    gatewayStatus('FONEPAY_MERCHANT_CODE', 'TEST_MERCHANT'),
            envVars:   ['FONEPAY_MERCHANT_CODE', 'FONEPAY_SECRET_KEY'],
            callbackUrl: `${appUrl}/api/payments/fonepay/callback`,
            docsUrl:   'https://developer.fonepay.com/',
            dashUrl:   'https://merchant.fonepay.com/',
            setupSteps: [
                'Call FonePay Business: +977-01-5970009 or email merchant@fonepay.com',
                'Submit: company registration, PAN, bank account details',
                'FonePay provides: Merchant Code (PID) and Secret Key',
                'Register your callback URL with FonePay support (not self-serve)',
                'Set FONEPAY_MERCHANT_CODE and FONEPAY_SECRET_KEY in Vercel env vars',
                'FonePay also gives a static QR image — use it for offline display only (not automated)',
            ],
        },
    ] as const

    const tiers = TIERS
    const featureKeys = Object.keys(TIER_FEATURES.free) as (keyof typeof TIER_FEATURES.free)[]

    return (
        <div className="space-y-6 max-w-[1400px] mx-auto pb-12">
            <PremiumPageHeader 
                title="Platform Config" 
                description="Tier feature matrix, subscription limits, and platform defaults." 
                icon={<Settings size={18} />}
                color="blue"
            />

            {/* Tier Feature Matrix */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center gap-3">
                    <Shield size={18} className="text-indigo-600" />
                    <div>
                        <h2 className="font-semibold text-ink">Tier Feature Matrix</h2>
                        <p className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Features unlocked per subscription tier</p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="border-b border-hairline">
                            <tr>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-ink-subtle uppercase tracking-wide bg-surface-muted">Feature</th>
                                {tiers.map(tier => (
                                    <th key={tier} className={`px-5 py-4 text-center text-xs font-bold uppercase tracking-wide border-l border-hairline ${TIER_STYLE[tier]}`}>
                                        {TIER_LABELS[tier]}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {featureKeys.map(key => (
                                <tr key={key} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-ink">{FEATURE_LABELS[key] || key}</td>
                                    {tiers.map(tier => (
                                        <td key={tier} className="px-5 py-3 text-center border-l border-hairline">
                                            {TIER_FEATURES[tier][key]
                                                ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                                                : <XCircle size={16} className="text-ink-subtle mx-auto" />
                                            }
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Tier Limits */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50">
                    <h2 className="font-semibold text-ink">Subscription Limits</h2>
                    <p className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Maximum staff and menu items per tier</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/50 border-b border-hairline">
                            <tr>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-ink-subtle uppercase">Tier</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-subtle uppercase">Max Staff</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-ink-subtle uppercase">Max Menu Items</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {tiers.map(tier => (
                                <tr key={tier} className="group hover:bg-surface-muted/50 transition-colors">
                                    <td className="px-5 py-4">
                                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${TIER_STYLE[tier]}`}>
                                            {TIER_LABELS[tier]}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-right font-semibold text-ink">
                                        {isUnlimited(TIER_LIMITS[tier].max_staff) ? 'Unlimited' : TIER_LIMITS[tier].max_staff}
                                    </td>
                                    <td className="px-5 py-4 text-right font-semibold text-ink">
                                        {isUnlimited(TIER_LIMITS[tier].max_menu_items) ? 'Unlimited' : TIER_LIMITS[tier].max_menu_items}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Platform Defaults */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-center gap-3">
                    <Settings size={18} className="text-ink-muted" />
                    <div>
                        <h2 className="font-semibold text-ink">Platform Defaults</h2>
                        <p className="text-[13px] font-semibold text-ink-subtle uppercase tracking-wider mt-1">Default settings applied to all new restaurant tenants</p>
                    </div>
                </div>
                <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <DefaultField label="Default Tax Rate" value={`${DEFAULT_PLATFORM.defaultTaxRate}%`} note="Applied to all new tenants" />
                    <DefaultField label="Default Currency" value={DEFAULT_PLATFORM.currency} note="ISO currency code" />
                    <DefaultField label="Currency Symbol" value={DEFAULT_PLATFORM.currencySymbol} note="Displayed in all prices" />
                    <DefaultField label="Nepal Pay (eSewa/Khalti)" value={DEFAULT_PLATFORM.nepalPayEnabled ? 'Enabled' : 'Disabled'} note="QR-based payment default" isBoolean enabled={DEFAULT_PLATFORM.nepalPayEnabled} />
                    <DefaultField label="VAT" value={DEFAULT_PLATFORM.vatEnabled ? 'Enabled' : 'Disabled'} note="IRD-registered VAT billing" isBoolean enabled={DEFAULT_PLATFORM.vatEnabled} />
                </div>
                <div className="px-6 pb-5">
                    <p className="text-xs text-ink-subtle bg-surface-muted rounded-lg p-3 border border-hairline">
                        Platform defaults are set in the codebase (<code className="font-mono bg-surface-muted px-1 rounded text-ink-muted">actions.ts → buildDefaultFeaturesV2()</code>). To update defaults, edit the source and redeploy.
                    </p>
                </div>
            </div>

            {/* Subscription Payment Methods */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <h2 className="font-semibold text-ink mb-4">Accepted Subscription Payment Methods</h2>
                <div className="flex flex-wrap gap-3">
                    {['Cash', 'eSewa', 'Khalti', 'Bank Transfer', 'FonePay'].map(method => (
                        <div key={method} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-700">
                            <CheckCircle size={13} />
                            {method}
                        </div>
                    ))}
                </div>
                <p className="text-xs text-ink-subtle mt-3">Methods available when recording subscription payments via the Restaurants page.</p>
            </div>

            {/* ─── Payment Gateway Setup ────────────────────────────────── */}
            <div className="bg-surface rounded-[24px] border border-hairline shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up">
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/50 flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <Zap size={18} className="text-amber-500" />
                        <div>
                            <h2 className="font-semibold text-ink">Payment Gateway Setup</h2>
                            <p className="text-[13px] text-ink-subtle mt-0.5">
                                Configure eSewa, Khalti and FonePay Business to enable instant tier activation when tenants pay.
                            </p>
                        </div>
                    </div>
                </div>

                {/* How it works banner */}
                <div className="px-6 pt-5 pb-1">
                    <div className="rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-blue-800 flex gap-3">
                        <Zap size={15} className="shrink-0 mt-0.5 text-blue-500" />
                        <div>
                            <p className="font-semibold mb-1">How auto-activation works</p>
                            <p className="text-blue-700 text-[13px]">
                                Tenant clicks "Pay with eSewa / Khalti / FonePay" → pays on the gateway's own page →
                                gateway redirects back to our <strong>Callback URL</strong> → we verify the signature →
                                tier upgrades instantly, no manual approval needed.
                                The <strong>static merchant QR</strong> FonePay gives you is for offline display only
                                and cannot be automated — use the programmatic flow above for in-app payments.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-5">
                    {gateways.map(gw => (
                        <div key={gw.id} className="rounded-2xl border border-hairline overflow-hidden">
                            {/* Gateway header */}
                            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-surface-muted/50 border-b border-hairline">
                                <div className="flex items-center gap-3">
                                    <span
                                        className="text-lg font-extrabold"
                                        style={{ color: gw.color }}
                                    >
                                        {gw.name}
                                    </span>
                                    <StatusBadge status={gw.status} />
                                </div>
                                <div className="flex gap-2">
                                    <a
                                        href={gw.dashUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] font-bold text-ink-subtle hover:text-ink px-3 py-1.5 rounded-lg border border-hairline bg-surface hover:bg-surface-muted transition-colors flex items-center gap-1"
                                    >
                                        Merchant Dashboard <ExternalLink size={11} />
                                    </a>
                                    <a
                                        href={gw.docsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[11px] font-bold text-ink-subtle hover:text-ink px-3 py-1.5 rounded-lg border border-hairline bg-surface hover:bg-surface-muted transition-colors flex items-center gap-1"
                                    >
                                        API Docs <ExternalLink size={11} />
                                    </a>
                                </div>
                            </div>

                            <div className="px-5 py-4 space-y-4">
                                {/* Callback URL — the most critical thing to register */}
                                <div>
                                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                        Callback URL — register this in the gateway dashboard
                                    </p>
                                    <GatewayCallbackCopy url={gw.callbackUrl} />
                                </div>

                                {/* Env vars needed */}
                                <div>
                                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-1.5">
                                        Vercel environment variables required
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                        {gw.envVars.map(v => (
                                            <code key={v} className="text-xs font-mono bg-surface-muted border border-hairline px-2 py-1 rounded-lg text-ink-muted">
                                                {v}
                                            </code>
                                        ))}
                                    </div>
                                </div>

                                {/* Setup steps */}
                                <div>
                                    <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">
                                        Registration steps
                                    </p>
                                    <ol className="space-y-1">
                                        {gw.setupSteps.map((step, i) => (
                                            <li key={i} className="flex gap-2.5 text-[13px] text-ink-subtle">
                                                <span className="shrink-0 w-4 h-4 rounded-full bg-surface-muted border border-hairline text-[10px] font-extrabold flex items-center justify-center text-ink-subtle mt-0.5">
                                                    {i + 1}
                                                </span>
                                                {step}
                                            </li>
                                        ))}
                                    </ol>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Vercel link */}
                    <div className="rounded-xl border border-hairline bg-surface-muted/50 p-4 flex items-start gap-3 text-sm">
                        <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="text-ink-subtle">
                            <span className="font-semibold text-ink">Set credentials in Vercel, not here.</span>
                            {' '}Gateway keys are server secrets — never stored in the database.
                            Go to{' '}
                            <a
                                href="https://vercel.com/dashboard"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--color-primary)] font-semibold hover:underline"
                            >
                                vercel.com/dashboard
                            </a>
                            {' '}→ your project → Settings → Environment Variables, then redeploy.
                        </div>
                    </div>
                </div>
            </div>

            {/* Dashboard Advertisements Manager */}
            <AdManager />
        </div>
    )
}

function StatusBadge({ status }: { status: 'live' | 'test' | 'unconfigured' }) {
    if (status === 'live') return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <CheckCircle size={10} /> Live
        </span>
    )
    if (status === 'test') return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <AlertTriangle size={10} /> Test mode
        </span>
    )
    return (
        <span className="flex items-center gap-1 text-[11px] font-bold text-ink-subtle bg-surface-muted border border-hairline px-2 py-0.5 rounded-full">
            <XCircle size={10} /> Not configured
        </span>
    )
}

function DefaultField({
    label,
    value,
    note,
    isBoolean = false,
    enabled = false,
}: {
    label: string
    value: string
    note: string
    isBoolean?: boolean
    enabled?: boolean
}) {
    return (
        <div className="bg-surface-muted rounded-xl p-4 border border-hairline">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-ink-subtle uppercase tracking-wide">{label}</span>
                {isBoolean && (enabled
                    ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    : <XCircle size={14} className="text-ink-subtle shrink-0" />
                )}
            </div>
            <div className={`text-lg font-extrabold mt-1 ${isBoolean ? (enabled ? 'text-emerald-700' : 'text-ink-subtle') : 'text-ink'}`}>
                {value}
            </div>
            <p className="text-xs text-ink-subtle mt-0.5">{note}</p>
        </div>
    )
}
