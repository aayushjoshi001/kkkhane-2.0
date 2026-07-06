import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react'

export default function PendingVerificationPage() {
    return (
        <div className="max-w-2xl mx-auto py-12 px-4 text-center">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                <Clock className="w-10 h-10" />
            </div>
            
            <h1 className="text-3xl font-bold text-ink mb-4">Payment Verification Pending</h1>
            <p className="text-lg text-ink-muted mb-8">
                We have received your payment reference code. Our team is currently reviewing it. Your subscription will be activated automatically once verified.
            </p>

            <Card className="p-6 bg-surface-muted border-hairline-strong text-left max-w-lg mx-auto mb-10">
                <h3 className="font-semibold text-ink mb-4 flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-brand-500" />
                    What happens next?
                </h3>
                <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />
                        <span className="text-ink-muted">Verification typically takes less than 15 minutes during standard business hours.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />
                        <span className="text-ink-muted">You will regain full access to your dashboard and POS instantly after approval.</span>
                    </li>
                    <li className="flex items-start gap-3">
                        <CheckCircle2 className="w-5 h-5 text-ink-subtle shrink-0 mt-0.5" />
                        <span className="text-ink-muted">If you experience delays, please contact our support team.</span>
                    </li>
                </ul>
            </Card>

            <div className="flex justify-center gap-4">
                <Button variant="primary" size="lg" href="/admin/dashboard">
                    Check Status
                </Button>
                <Button variant="secondary" size="lg" href="mailto:support@kkkhane.com">
                    Contact Support
                </Button>
            </div>
        </div>
    )
}
