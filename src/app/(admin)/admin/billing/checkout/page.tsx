'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Shield, ArrowRight, ArrowLeft, Building2, Smartphone } from 'lucide-react'
import { useSearchParams, useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { submitPaymentReferenceAction } from './actions'

const PRICES = {
    '3_months': 4500,
    '6_months': 8100,
    '1_year': 14400,
}

const CYCLE_NAMES = {
    '3_months': '3 Months',
    '6_months': '6 Months',
    '1_year': '1 Year',
}

export default function CheckoutPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    
    const plan = searchParams.get('plan')
    const cycleStr = searchParams.get('cycle')
    
    const cycle = Object.keys(PRICES).includes(cycleStr || '') ? cycleStr as keyof typeof PRICES : '3_months'
    const amount = PRICES[cycle]
    
    const [method, setMethod] = useState<'esewa' | 'bank'>('esewa')
    const [reference, setReference] = useState('')
    const [isSubmitting, setIsSubmitting] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!reference.trim()) {
            toast.error('Please enter the transaction reference code')
            return
        }

        setIsSubmitting(true)
        try {
            const res = await submitPaymentReferenceAction({
                amount,
                method,
                reference_code: reference,
                notes: `Subscription upgrade: ${plan} for ${cycle}`
            })

            if (res.error) throw new Error(res.error)
            
            toast.success('Payment submitted for verification!')
            router.push('/admin/billing/pending')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setIsSubmitting(false)
        }
    }

    if (plan !== 'pro') {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh]">
                <p className="text-ink-subtle mb-4">Invalid plan selected.</p>
                <Button variant="secondary" onClick={() => router.push('/admin/billing/packages')}>
                    Go Back
                </Button>
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto py-8 px-4">
            <button 
                onClick={() => router.back()}
                className="flex items-center gap-2 text-sm text-ink-subtle hover:text-ink mb-8 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" /> Back to Packages
            </button>

            <div className="grid md:grid-cols-[1fr_380px] gap-8">
                {/* Payment Form */}
                <div>
                    <h1 className="text-3xl font-bold text-ink mb-2">Complete your upgrade</h1>
                    <p className="text-ink-muted mb-8">
                        Select a payment method and upload your transaction reference to activate the Pro Plan.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-ink">Payment Method</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <label 
                                    className={`relative flex items-center justify-center p-4 border-2 rounded-xl cursor-pointer transition-all ${
                                        method === 'esewa' 
                                        ? 'border-green-500 bg-green-50/50' 
                                        : 'border-hairline-strong hover:border-hairline-strong'
                                    }`}
                                >
                                    <input type="radio" name="method" className="sr-only" checked={method === 'esewa'} onChange={() => setMethod('esewa')} />
                                    <div className="flex flex-col items-center gap-2">
                                        <Smartphone className={`w-6 h-6 ${method === 'esewa' ? 'text-green-600' : 'text-ink-subtle'}`} />
                                        <span className={`font-medium ${method === 'esewa' ? 'text-green-700' : 'text-ink-muted'}`}>eSewa / Khalti</span>
                                    </div>
                                </label>
                                <label 
                                    className={`relative flex items-center justify-center p-4 border-2 rounded-xl cursor-pointer transition-all ${
                                        method === 'bank' 
                                        ? 'border-brand-500 bg-brand-50/50' 
                                        : 'border-hairline-strong hover:border-hairline-strong'
                                    }`}
                                >
                                    <input type="radio" name="method" className="sr-only" checked={method === 'bank'} onChange={() => setMethod('bank')} />
                                    <div className="flex flex-col items-center gap-2">
                                        <Building2 className={`w-6 h-6 ${method === 'bank' ? 'text-brand-600' : 'text-ink-subtle'}`} />
                                        <span className={`font-medium ${method === 'bank' ? 'text-brand-700' : 'text-ink-muted'}`}>Bank Transfer</span>
                                    </div>
                                </label>
                            </div>
                        </div>

                        <Card className="p-6 bg-surface-muted border-hairline-strong">
                            {method === 'esewa' ? (
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-ink">Digital Wallet Transfer</h4>
                                    <p className="text-sm text-ink-muted">Send the exact amount to the following eSewa/Khalti number:</p>
                                    <div className="p-3 bg-surface rounded border border-hairline-strong font-mono text-lg text-center font-semibold text-green-700">
                                        9800000000
                                    </div>
                                    <p className="text-xs text-ink-subtle text-center mt-2">Account Name: KK Khane Pvt. Ltd.</p>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <h4 className="font-semibold text-ink">Bank Transfer Details</h4>
                                    <div className="space-y-2 text-sm text-ink-muted">
                                        <div className="flex justify-between p-2 bg-surface rounded border border-hairline">
                                            <span>Bank Name</span><span className="font-medium text-ink">NABIL BANK</span>
                                        </div>
                                        <div className="flex justify-between p-2 bg-surface rounded border border-hairline">
                                            <span>Account Name</span><span className="font-medium text-ink">KK KHANE PVT LTD</span>
                                        </div>
                                        <div className="flex justify-between p-2 bg-surface rounded border border-hairline">
                                            <span>Account No.</span><span className="font-medium text-ink font-mono">01234567890123</span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </Card>

                        <div className="space-y-4">
                            <h3 className="text-lg font-semibold text-ink">Verify Payment</h3>
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-ink-muted">Transaction Reference / Remarks Code</label>
                                <input
                                    type="text"
                                    required
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder="e.g. 0XF98..."
                                    className="w-full px-4 py-3 rounded-xl border border-hairline-strong focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 outline-none transition-all font-mono"
                                />
                                <p className="text-xs text-ink-subtle">
                                    Enter the reference code from your bank or wallet receipt to help us verify your payment quickly.
                                </p>
                            </div>
                        </div>

                        <Button 
                            type="submit" 
                            variant="primary" 
                            size="lg" 
                            block 
                            className="text-base"
                            loading={isSubmitting}
                            icon={ArrowRight}
                        >
                            Submit Payment for Verification
                        </Button>
                    </form>
                </div>

                {/* Order Summary */}
                <div className="relative">
                    <div className="sticky top-24 space-y-6">
                        <Card className="p-6 border-hairline-strong">
                            <h3 className="font-semibold text-ink mb-6">Order Summary</h3>
                            
                            <div className="space-y-4 mb-6">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="font-medium text-ink">Pro Business Plan</div>
                                        <div className="text-sm text-ink-subtle">Billed for {CYCLE_NAMES[cycle]}</div>
                                    </div>
                                    <div className="font-medium text-ink">
                                        NPR {amount.toLocaleString()}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="pt-4 border-t border-hairline space-y-3 mb-6">
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-ink-subtle">Subtotal</span>
                                    <span className="font-medium text-ink">NPR {amount.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="text-ink-subtle">Tax (13% VAT included)</span>
                                    <span className="font-medium text-ink">NPR 0</span>
                                </div>
                            </div>
                            
                            <div className="pt-4 border-t border-hairline-strong flex justify-between items-center">
                                <span className="font-semibold text-ink">Total Due</span>
                                <span className="text-xl font-bold text-brand-600">NPR {amount.toLocaleString()}</span>
                            </div>
                        </Card>

                        <div className="flex items-start gap-3 p-4 bg-surface-muted rounded-xl text-sm text-ink-muted">
                            <Shield className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />
                            <p>
                                Your subscription will be activated automatically once our team verifies the payment reference. This usually takes less than 15 minutes during business hours.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
