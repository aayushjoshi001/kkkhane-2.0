'use client'

import { useState } from 'react'
import { Card, Button, Badge } from '@/components/ui'
import { CheckCircle2, Zap, Shield, HelpCircle } from 'lucide-react'
import { selectFreePlanAction } from './actions'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

type BillingCycle = '3_months' | '6_months' | '1_year'

export default function PackagesPage() {
    const router = useRouter()
    const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
    const [cycle, setCycle] = useState<BillingCycle>('3_months')

    const proPrices = {
        '3_months': 4500, // NPR 4,500 total (1500/mo)
        '6_months': 8100, // NPR 8,100 total (1350/mo - 10% off)
        '1_year': 14400,  // NPR 14,400 total (1200/mo - 20% off)
    }

    const proMonthlyEquiv = {
        '3_months': 1500,
        '6_months': 1350,
        '1_year': 1200,
    }

    async function handleSelectFree() {
        setLoadingPlan('free')
        try {
            const res = await selectFreePlanAction()
            if (res.error) throw new Error(res.error)
            toast.success('Successfully switched to Free Plan')
            window.location.href = '/admin/dashboard'
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setLoadingPlan(null)
        }
    }

    async function handleSelectPaid() {
        setLoadingPlan('pro')
        try {
            // Redirect to a checkout or manual payment instructions page
            router.push(`/admin/billing/checkout?plan=pro&cycle=${cycle}`)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
            setLoadingPlan(null)
        }
    }

    return (
        <div className="max-w-6xl mx-auto py-8 px-4">
            <div className="text-center max-w-2xl mx-auto mb-12">
                <Badge tone="brand" className="mb-4">Subscription & Billing</Badge>
                <h1 className="text-4xl font-bold text-gray-900 mb-4 tracking-tight">
                    Choose the right plan for your restaurant
                </h1>
                <p className="text-lg text-gray-600">
                    Your trial or previous subscription has expired. Select a package below to reactivate your access and continue managing your restaurant seamlessly.
                </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 items-start">
                {/* Free Plan */}
                <Card className="relative overflow-hidden border-2 border-transparent hover:border-gray-200 transition-colors p-8 flex flex-col h-full bg-white shadow-sm hover:shadow-md">
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">Free Starter</h3>
                        <p className="text-gray-500 min-h-[48px]">Perfect for small food stalls or testing the waters.</p>
                    </div>
                    <div className="mb-6">
                        <span className="text-4xl font-extrabold text-gray-900">NPR 0</span>
                        <span className="text-gray-500"> / forever</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        {[
                            'Up to 1 Staff Member (Owner)',
                            'Max 20 Menu Items',
                            'Basic POS Features',
                            'Standard Email Support',
                            'No Kitchen Display System'
                        ].map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                                <span className="text-gray-600">{feature}</span>
                            </li>
                        ))}
                    </ul>
                    <Button 
                        block 
                        variant="secondary" 
                        size="lg" 
                        className="bg-gray-100 hover:bg-gray-200 text-gray-900 border-none"
                        loading={loadingPlan === 'free'}
                        onClick={handleSelectFree}
                    >
                        Continue with Free
                    </Button>
                </Card>

                {/* Pro Plan (Highlighted) */}
                <Card className="relative overflow-hidden border-2 border-brand-500 shadow-xl p-8 flex flex-col h-full bg-white transform md:-translate-y-4">
                    <div className="absolute top-0 inset-x-0 h-1.5 bg-brand-500" />
                    <div className="absolute top-4 right-4">
                        <Badge tone="brand" className="bg-brand-100 text-brand-700 border-none">Most Popular</Badge>
                    </div>
                    
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                            <Zap className="w-6 h-6 text-brand-500" />
                            Pro Business
                        </h3>
                        <p className="text-gray-500 min-h-[48px]">Everything you need to run and scale a growing restaurant.</p>
                    </div>

                    {/* Billing Cycle Toggle */}
                    <div className="bg-gray-50 p-1.5 rounded-xl flex gap-1 mb-6">
                        {(['3_months', '6_months', '1_year'] as const).map(c => (
                            <button
                                key={c}
                                onClick={() => setCycle(c)}
                                className={`flex-1 text-sm font-medium py-2 rounded-lg transition-all duration-200 ${
                                    cycle === c 
                                    ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200' 
                                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                }`}
                            >
                                {c.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                            </button>
                        ))}
                    </div>

                    <div className="mb-6 flex flex-col">
                        <div className="flex items-end gap-2">
                            <span className="text-4xl font-extrabold text-gray-900">NPR {proMonthlyEquiv[cycle].toLocaleString()}</span>
                            <span className="text-gray-500 mb-1">/ month</span>
                        </div>
                        <div className="text-sm text-brand-600 font-medium mt-1">
                            Billed as NPR {proPrices[cycle].toLocaleString()} every {cycle.replace('_', ' ')}
                        </div>
                    </div>

                    <ul className="space-y-4 mb-8 flex-1">
                        {[
                            'Unlimited Staff & Roles',
                            'Unlimited Menu Items',
                            'Advanced POS & Waiter App',
                            'Kitchen Display System (KDS)',
                            'Advanced Analytics & Reports',
                            'Priority 24/7 Support'
                        ].map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-brand-500 shrink-0 mt-0.5" />
                                <span className="text-gray-800 font-medium">{feature}</span>
                            </li>
                        ))}
                    </ul>
                    <Button 
                        block 
                        variant="primary" 
                        size="lg" 
                        className="bg-brand-600 hover:bg-brand-700 shadow-brand-500/25 shadow-lg"
                        loading={loadingPlan === 'pro'}
                        onClick={handleSelectPaid}
                    >
                        Upgrade to Pro
                    </Button>
                </Card>

                {/* Custom Plan */}
                <Card className="relative overflow-hidden border-2 border-transparent hover:border-gray-200 transition-colors p-8 flex flex-col h-full bg-gray-50 shadow-sm">
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                            <Shield className="w-6 h-6 text-gray-700" />
                            Enterprise
                        </h3>
                        <p className="text-gray-500 min-h-[48px]">Tailored solutions for franchises and large chains.</p>
                    </div>
                    <div className="mb-6">
                        <span className="text-4xl font-extrabold text-gray-900">Custom</span>
                    </div>
                    <ul className="space-y-4 mb-8 flex-1">
                        {[
                            'Multi-Location Management',
                            'Custom POS Hardware Integrations',
                            'Dedicated Account Manager',
                            'On-site Training & Setup',
                            'Custom Feature Development'
                        ].map((feature, i) => (
                            <li key={i} className="flex items-start gap-3">
                                <CheckCircle2 className="w-5 h-5 text-gray-700 shrink-0 mt-0.5" />
                                <span className="text-gray-600">{feature}</span>
                            </li>
                        ))}
                    </ul>
                    <Button
                        block
                        variant="secondary"
                        size="lg"
                        onClick={() => window.location.href = 'mailto:enterprise@kkkhane.com?subject=Enterprise%20Plan%20Inquiry'}
                    >
                        Contact Sales
                    </Button>
                </Card>
            </div>

            <div className="mt-16 bg-blue-50 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
                        <HelpCircle className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                        <h4 className="text-lg font-semibold text-gray-900">Have questions about our plans?</h4>
                        <p className="text-blue-800/80">Our team is here to help you choose the right package.</p>
                    </div>
                </div>
                <Button variant="secondary" className="bg-white text-blue-700 hover:bg-blue-50 border-blue-200 whitespace-nowrap" onClick={() => window.location.href = 'mailto:support@kkkhane.com'}>
                    Talk to an Expert
                </Button>
            </div>
        </div>
    )
}
