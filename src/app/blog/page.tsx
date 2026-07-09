import { MarketingNav, MarketingFooter, MarketingButton } from '@/components/marketing'

export default function BlogPage() {
    return (
        <div className="min-h-screen bg-transparent text-ink font-sans">
            <MarketingNav />
            <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 pt-20 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface shadow-sm border border-hairline text-4xl"></div>
                <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-ink">Feature Coming Soon</h1>
                <p className="mb-8 max-w-md font-medium text-ink-subtle">
                    We are currently crafting our blog. Stay tuned for exciting updates, tips, and industry news!
                </p>
                <MarketingButton href="/">Back to Home</MarketingButton>
            </div>
            <MarketingFooter />
        </div>
    )
}
