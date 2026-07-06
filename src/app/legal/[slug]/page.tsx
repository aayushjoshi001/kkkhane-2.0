import { MarketingNav, MarketingFooter, Eyebrow, MarketingButton } from '@/components/marketing'

const LEGAL_CONTENT: Record<string, { title: string, subtitle: string, lastUpdated: string, content: React.ReactNode }> = {
    'privacy': {
        title: 'Privacy Policy',
        subtitle: 'How we collect, use, and protect your data.',
        lastUpdated: 'June 22, 2026',
        content: (
            <>
                <p>At kkkhane, we value your privacy and are committed to protecting your personal and business data. This policy explains how we handle your information.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. Information Collection</h3>
                <p>We collect information you provide directly to us when you create an account, use our services, process payments, or communicate with our support team. This includes your restaurant details, staff information, and customer ordering data.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. Data Security</h3>
                <p>We implement enterprise-grade security measures to maintain the safety of your data. All sensitive/credit information transmitted is encrypted via Secure Socket Layer (SSL) technology and securely stored in our cloud infrastructure.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Data Sharing</h3>
                <p>We do not sell, trade, or otherwise transfer your personally identifiable information or your restaurant&apos;s business data to outside parties. This does not include trusted third parties who assist us in operating our website or servicing you, so long as those parties agree to keep this information confidential.</p>
            </>
        )
    },
    'terms': {
        title: 'Terms & Conditions',
        subtitle: 'The rules and guidelines for using our platform.',
        lastUpdated: 'June 22, 2026',
        content: (
            <>
                <p>By accessing or using the kkkhane platform, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. Service Availability</h3>
                <p>We strive to provide 99.9% uptime for our cloud systems. However, we do not guarantee uninterrupted or error-free access to the service and may occasionally perform scheduled maintenance.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. Account Responsibilities</h3>
                <p>You are entirely responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must notify us immediately of any unauthorized use of your account.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Acceptable Use</h3>
                <p>You agree not to use the service for any illegal purposes or to conduct any activity that would violate the rights of others or the laws of Nepal.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">4. Termination</h3>
                <p>We reserve the right to terminate or suspend access to our service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.</p>
            </>
        )
    },
    'refund': {
        title: 'Refund Policy',
        subtitle: 'Our cancellation and refund procedures.',
        lastUpdated: 'June 22, 2026',
        content: (
            <>
                <p>We want you to be completely satisfied with kkkhane. We offer transparent subscription models and clear refund policies.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. Subscription Cancellations</h3>
                <p>You may cancel your subscription at any time. Your access to premium features will continue until the end of your current billing period. Once the period ends, your account will revert to the Free tier.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. 14-Day Money Back Guarantee</h3>
                <p>If you are not satisfied with your annual subscription purchase, you may request a full refund within the first 14 days of your initial payment. Monthly subscriptions are non-refundable after the first 48 hours.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Hardware Returns</h3>
                <p>Any POS hardware (Printers, Power Backups, Tablets) purchased through kkkhane can be returned within 7 days of delivery, provided the equipment is unused, undamaged, and in its original packaging. A restocking fee may apply.</p>
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">4. Process for Requesting Refunds</h3>
                <p>To request a refund or return, please contact our billing department at support@kkkhane.com. Refunds will be processed to the original method of payment within 5-7 business days.</p>
            </>
        )
    }
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const page = LEGAL_CONTENT[slug]

    if (!page) {
        return (
            <div className="min-h-screen bg-[#FAFAF8] text-ink font-sans">
                <MarketingNav />
                <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 pt-20 text-center">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface border border-hairline shadow-sm text-4xl">📄</div>
                    <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-ink">Page Not Found</h1>
                    <p className="mb-8 max-w-md font-medium text-ink-subtle">The document you&apos;re looking for does not exist or has been moved.</p>
                    <MarketingButton href="/">Back to Home</MarketingButton>
                </div>
                <MarketingFooter />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#FAFAF8] text-ink font-sans">
            <MarketingNav />

            <main className="pb-24 pt-32">
                <div className="mx-auto max-w-4xl px-4 sm:px-6">
                    <div className="rounded-[2.5rem] border border-hairline bg-surface p-8 sm:p-12 md:p-16 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"></div>
                        <div className="mb-12">
                            <div className="mb-4"><Eyebrow tone="brand">Legal Documents</Eyebrow></div>
                            <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-ink md:text-5xl">{page.title}</h1>
                            <p className="mb-8 text-xl font-medium text-ink-subtle">{page.subtitle}</p>
                            <div className="inline-block rounded-full bg-surface-muted px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-subtle">
                                Last Updated: {page.lastUpdated}
                            </div>
                        </div>
                        
                        <div className="prose prose-lg prose-gray max-w-none prose-headings:font-extrabold prose-p:font-medium prose-p:text-ink-muted prose-p:leading-relaxed">
                            {page.content}
                        </div>
                    </div>
                </div>
            </main>

            <MarketingFooter />
        </div>
    )
}
