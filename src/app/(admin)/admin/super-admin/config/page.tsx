import { requireRole } from '@/lib/auth'
import { Settings, CheckCircle, XCircle, Shield } from 'lucide-react'
import PremiumPageHeader from '@/components/admin/PremiumPageHeader'

export const dynamic = 'force-dynamic'

// Mirrors TIER_FEATURES and TIER_LIMITS from actions.ts — source of truth
const TIER_FEATURES = {
    free: {
        loyaltyEnabled: false,
        promosEnabled: true,
        takeoutEnabled: false,
        multiLanguageEnabled: false,
        serviceRequestsEnabled: true,
        splitBillingEnabled: true,
        dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false,
        staffShiftsEnabled: false,
    },
    basic: {
        loyaltyEnabled: false,
        promosEnabled: true,
        takeoutEnabled: true,
        multiLanguageEnabled: false,
        serviceRequestsEnabled: true,
        splitBillingEnabled: true,
        dynamicPricingEnabled: false,
        ingredientTrackingEnabled: false,
        staffShiftsEnabled: false,
    },
    pro: {
        loyaltyEnabled: true,
        promosEnabled: true,
        takeoutEnabled: true,
        multiLanguageEnabled: false,
        serviceRequestsEnabled: true,
        splitBillingEnabled: true,
        dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true,
        staffShiftsEnabled: true,
    },
    enterprise: {
        loyaltyEnabled: true,
        promosEnabled: true,
        takeoutEnabled: true,
        multiLanguageEnabled: true,
        serviceRequestsEnabled: true,
        splitBillingEnabled: true,
        dynamicPricingEnabled: true,
        ingredientTrackingEnabled: true,
        staffShiftsEnabled: true,
    },
}

const TIER_LIMITS = {
    free: { max_staff: 3, max_menu_items: 20 },
    basic: { max_staff: 10, max_menu_items: 100 },
    pro: { max_staff: 50, max_menu_items: 500 },
    enterprise: { max_staff: 999, max_menu_items: 9999 },
}

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
}

const TIER_STYLE: Record<string, string> = {
    free: 'bg-gray-50 text-gray-700 border-gray-200',
    basic: 'bg-blue-50 text-blue-700 border-blue-200',
    pro: 'bg-purple-50 text-purple-700 border-purple-200',
    enterprise: 'bg-amber-50 text-amber-700 border-amber-200',
}

const DEFAULT_PLATFORM = {
    defaultTaxRate: 13,
    currency: 'NPR',
    currencySymbol: 'Rs.',
    nepalPayEnabled: true,
    vatEnabled: false,
}

export default async function ConfigPage() {
    await requireRole('super_admin')

    const tiers = ['free', 'basic', 'pro', 'enterprise'] as const
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
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <Shield size={18} className="text-indigo-600" />
                    <div>
                        <h2 className="font-semibold text-gray-800">Tier Feature Matrix</h2>
                        <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Features unlocked per subscription tier</p>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide bg-gray-50">Feature</th>
                                {tiers.map(tier => (
                                    <th key={tier} className={`px-5 py-4 text-center text-xs font-bold uppercase tracking-wide border-l border-gray-100 ${TIER_STYLE[tier]}`}>
                                        {tier}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {featureKeys.map(key => (
                                <tr key={key} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-3 font-medium text-gray-800">{FEATURE_LABELS[key] || key}</td>
                                    {tiers.map(tier => (
                                        <td key={tier} className="px-5 py-3 text-center border-l border-gray-100">
                                            {TIER_FEATURES[tier][key]
                                                ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                                                : <XCircle size={16} className="text-gray-200 mx-auto" />
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
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50">
                    <h2 className="font-semibold text-gray-800">Subscription Limits</h2>
                    <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Maximum staff and menu items per tier</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50/50 border-b border-gray-100">
                            <tr>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Tier</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Max Staff</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Max Menu Items</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {tiers.map(tier => (
                                <tr key={tier} className="group hover:bg-gray-50/50 transition-colors">
                                    <td className="px-5 py-4">
                                        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${TIER_STYLE[tier]}`}>
                                            {tier.charAt(0).toUpperCase() + tier.slice(1)}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                                        {TIER_LIMITS[tier].max_staff === 999 ? 'Unlimited' : TIER_LIMITS[tier].max_staff}
                                    </td>
                                    <td className="px-5 py-4 text-right font-semibold text-gray-900">
                                        {TIER_LIMITS[tier].max_menu_items === 9999 ? 'Unlimited' : TIER_LIMITS[tier].max_menu_items}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Platform Defaults */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] overflow-hidden animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center gap-3">
                    <Settings size={18} className="text-gray-600" />
                    <div>
                        <h2 className="font-semibold text-gray-800">Platform Defaults</h2>
                        <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Default settings applied to all new restaurant tenants</p>
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
                    <p className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3 border border-gray-100">
                        Platform defaults are set in the codebase (<code className="font-mono bg-gray-100 px-1 rounded text-gray-600">actions.ts → buildDefaultFeaturesV2()</code>). To update defaults, edit the source and redeploy.
                    </p>
                </div>
            </div>

            {/* Subscription Payment Methods */}
            <div className="bg-white rounded-[24px] border border-gray-100 shadow-[0_4px_20px_rgb(0,0,0,0.03)] p-6 animate-fade-up" style={{ animationDelay: '0.2s' }}>
                <h2 className="font-semibold text-gray-800 mb-4">Accepted Subscription Payment Methods</h2>
                <div className="flex flex-wrap gap-3">
                    {['Cash', 'eSewa', 'Khalti', 'Bank Transfer', 'FonePay'].map(method => (
                        <div key={method} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-sm font-medium text-emerald-700">
                            <CheckCircle size={13} />
                            {method}
                        </div>
                    ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">Methods available when recording subscription payments via the Restaurants page.</p>
            </div>
        </div>
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
        <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
                {isBoolean && (enabled
                    ? <CheckCircle size={14} className="text-emerald-500 shrink-0" />
                    : <XCircle size={14} className="text-gray-300 shrink-0" />
                )}
            </div>
            <div className={`text-lg font-extrabold mt-1 ${isBoolean ? (enabled ? 'text-emerald-700' : 'text-gray-400') : 'text-gray-900'}`}>
                {value}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{note}</p>
        </div>
    )
}
