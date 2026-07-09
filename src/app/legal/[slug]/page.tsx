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
            <section>
                <h2>Refund Policy</h2>
                <p>We stand behind our product. If you are not completely satisfied with your purchase, you may request a full refund within 14 days of your initial subscription payment.</p>
                <ul>
                    <li>The refund applies only to the first payment of your subscription.</li>
                    <li>Setup fees, hardware purchases, or customized development work are non-refundable.</li>
                    <li>After 14 days, all payments are non-refundable, but you may cancel your subscription at any time to prevent future charges.</li>
                </ul>
                <p>To request a refund or return, please contact our billing department at info.kkkhane@gmail.com. Refunds will be processed to the original method of payment within 5-7 business days.</p>
            </section>
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
