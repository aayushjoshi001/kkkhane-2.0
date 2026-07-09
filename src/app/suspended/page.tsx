import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

export default function SuspendedPage() {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-ink">
            <div className="w-full max-w-md rounded-2xl bg-surface p-10 shadow-2xl text-center mx-4">
                <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
                    <AlertTriangle className="w-8 h-8 text-amber-500" />
                </div>
                <h1 className="text-2xl font-bold text-ink mb-2">Account Suspended</h1>
                <p className="text-ink-subtle mb-2">
                    Your restaurant&apos;s subscription has expired and access has been suspended.
                </p>
                <p className="text-ink-subtle text-sm mb-8">
                    To reactivate your account, please renew your subscription by contacting support.
                </p>
                <div className="flex flex-col gap-3">
                    <a
                        href="mailto:info.kkkhane@gmail.com?subject=Subscription+Renewal"
                        className="inline-flex items-center justify-center rounded-xl bg-ink px-6 py-3 text-sm font-semibold text-white hover:bg-gray-800 transition"
                    >
                        Contact Support to Renew
                    </a>
                    <Link
                        href="/login"
                        className="inline-flex items-center justify-center rounded-xl border border-hairline-strong px-6 py-3 text-sm font-medium text-ink-muted hover:bg-surface-muted transition"
                    >
                        Back to Login
                    </Link>
                </div>
            </div>
        </div>
    )
}
