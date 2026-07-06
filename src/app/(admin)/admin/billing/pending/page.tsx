'use client'

import { Card, Button } from '@/components/ui'
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function PendingVerificationPage() {
    const router = useRouter()

    return (
        <div className="max-w-2xl mx-auto py-12 px-4 text-center">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                <Clock className="w-10 h-10" />
            </div>
            
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Payment Verification Pending</h1>
            <p className="text-lg text-gray-600 mb-8">
                We have received your payment reference code. Our team is currently reviewing it. Your subscription will be activated automatically once verified.
            </p>

            <Card className="p-6 bg-gray-50 border-gray-200 text-left max-w-lg mx-auto mb-10">
                <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-brand-500" />
                    What happens next?
                </h3>
                <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                        <span className="text-gray-600">Verification typically takes less than 15 minutes during standard business hours.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                        <span className="text-gray-600">You will regain full access to your dashboard and POS instantly after approval.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
                        <span className="text-gray-600">If you experience delays, please contact our support team.</span>
                    </li>
                </ul>
            </Card>

            <div className="flex justify-center gap-4">
                <Button 
                    variant="primary" 
                    size="lg" 
                    onClick={() => router.push('/admin/dashboard')}
                >
                    Check Status
                </Button>
                <Button
                    variant="secondary"
                    size="lg"
                    onClick={() => window.location.href = 'mailto:support@kkkhane.com'}
                >
                    Contact Support
                </Button>
            </div>
        </div>
    )
}
