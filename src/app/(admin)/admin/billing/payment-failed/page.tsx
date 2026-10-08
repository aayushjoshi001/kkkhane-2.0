import Button from '@/components/ui/Button'
import { XCircle, RotateCcw, MessageCircle } from 'lucide-react'

export default function PaymentFailedPage() {
    return (
        <div className="max-w-xl mx-auto py-14 px-4 text-center">
            <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                <XCircle className="w-10 h-10 text-red-500" />
            </div>

            <h1 className="text-2xl font-bold text-ink mb-3">Payment not completed</h1>
            <p className="text-ink-muted mb-8">
                Your payment was cancelled or could not be verified. No charge has been made.
                You can try again or pay via bank transfer if the issue persists.
            </p>

            <div className="flex flex-col sm:flex-row justify-center gap-3">
                <Button variant="primary" size="lg" href="/admin/billing/packages" icon={RotateCcw}>
                    Try again
                </Button>
                <Button variant="secondary" size="lg" href="mailto:info.kkkhane@gmail.com" icon={MessageCircle}>
                    Contact support
                </Button>
            </div>
        </div>
    )
}
