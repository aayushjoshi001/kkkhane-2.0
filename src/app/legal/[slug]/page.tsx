import { MarketingNav, MarketingFooter, Eyebrow, MarketingButton } from '@/components/marketing'

const LEGAL_CONTENT: Record<string, { title: string, subtitle: string, lastUpdated: string, content: React.ReactNode }> = {
    'privacy': {
        title: 'Privacy Policy',
        subtitle: 'How we collect, use, and protect your data.',
        lastUpdated: 'July 10, 2026',
        content: (
            <>
                <p>At KKKhane, we prioritize your privacy and data security. This Privacy Policy details the types of personal and business information we collect, how it is used, and the steps we take to ensure your data remains protected when using our restaurant management platform.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. Information Collection</h3>
                <p>When you register for an account, subscribe to our services, or contact support, we collect the following information:</p>
                <ul>
                    <li><strong>Business Information:</strong> Restaurant name, address, tax identification numbers (PAN/VAT), and business contacts.</li>
                    <li><strong>Personal Information:</strong> Names, email addresses, and phone numbers of the account owner and authorized staff members.</li>
                    <li><strong>Operational Data:</strong> Menu items, pricing, transaction logs, inventory levels, and customer order histories processed through our platform.</li>
                </ul>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. How We Use Your Information</h3>
                <p>The information we collect is strictly used to provide, maintain, and improve our services. This includes:</p>
                <ul>
                    <li>Processing and verifying your subscription payments.</li>
                    <li>Generating compliance-ready invoices and financial reports.</li>
                    <li>Sending automated alerts (e.g., low stock warnings, system updates).</li>
                    <li>Providing targeted technical support and troubleshooting.</li>
                </ul>

                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Data Security & Storage</h3>
                <p>We implement enterprise-grade security measures to safeguard your data. All sensitive information transmitted between your browser and our servers is encrypted using Secure Socket Layer (SSL) technology. Data is securely stored in distributed cloud infrastructures with automated daily backups to prevent data loss.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">4. Third-Party Sharing</h3>
                <p>We do not sell, trade, or otherwise transfer your personally identifiable information or your restaurant&apos;s business data to outside parties. We may only share information with trusted third-party service providers (such as payment gateways and cloud hosting providers) who assist us in operating our platform, provided they agree to keep this information confidential and comply with strict data protection standards.</p>
            </>
        )
    },
    'terms': {
        title: 'Terms & Conditions',
        subtitle: 'The rules and guidelines for using our platform.',
        lastUpdated: 'July 10, 2026',
        content: (
            <>
                <p>Welcome to KKKhane. By accessing or using our platform, you agree to be bound by these Terms of Service. Please read them carefully. If you do not agree with any part of these terms, you may not access our services.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. Account Registration and Responsibilities</h3>
                <p>To use our services, you must register for an account. You agree to provide accurate, current, and complete information during the registration process. You are entirely responsible for safeguarding your account credentials. Any activities or actions performed under your account, whether authorized by you or not, remain your responsibility.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. Service Availability & Uptime</h3>
                <p>We strive to provide a 99.9% uptime for our cloud systems to ensure your restaurant operations run smoothly. However, we do not guarantee completely uninterrupted or error-free access to the service. We may occasionally perform scheduled maintenance, which we will communicate in advance whenever possible.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Subscription and Billing</h3>
                <p>Our services are billed on a subscription basis (monthly or annually). By subscribing, you agree to pay all applicable fees associated with your chosen plan. Failure to pay may result in the suspension or termination of your account. We reserve the right to modify our pricing, but any changes will only apply to future billing cycles with prior notice.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">4. Acceptable Use Policy</h3>
                <p>You agree not to use the KKKhane platform for any illegal activities or to violate any laws in your jurisdiction (including, but not limited to, tax evasion or data theft). You must not attempt to reverse-engineer the software, disrupt our servers, or gain unauthorized access to other user accounts.</p>
            </>
        )
    },
    'refund': {
        title: 'Refund Policy',
        subtitle: 'Our cancellation and refund procedures.',
        lastUpdated: 'July 10, 2026',
        content: (
            <>
                <p>We stand behind the quality of the KKKhane platform. We want you to be completely satisfied with your purchase. If you are not satisfied, we offer a transparent and straightforward refund policy.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">1. 14-Day Money Back Guarantee</h3>
                <p>If you are not entirely satisfied with your subscription, you may request a full refund within <strong>14 days</strong> of your initial payment. This guarantee applies to your first payment on any new annual or monthly subscription plan.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">2. Non-Refundable Items</h3>
                <p>Please note that the following purchases are strictly non-refundable:</p>
                <ul>
                    <li>One-time setup or onboarding fees.</li>
                    <li>Any hardware purchased directly through KKKhane (e.g., thermal printers, tablets) once opened or used, unless defective upon arrival.</li>
                    <li>Custom development or bespoke integration services.</li>
                    <li>Subscription renewals after the initial 14-day period has passed.</li>
                </ul>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">3. Cancellations</h3>
                <p>You may cancel your subscription at any time to prevent future billing. If you cancel after the 14-day window, you will not receive a refund for the current billing cycle, but your premium access will remain active until the end of the paid period. Afterward, your account will revert to the Free tier.</p>
                
                <h3 className="mb-4 mt-8 text-xl font-extrabold text-ink">4. How to Request a Refund</h3>
                <p>To initiate a refund, please contact our billing department directly at <strong>info.kkkhane@gmail.com</strong> with your account details and the reason for the request. Approved refunds will be processed and credited back to the original method of payment within 5-7 business days.</p>
            </>
        )
    }
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const page = LEGAL_CONTENT[slug]

    if (!page) {
        return (
            <div className="min-h-screen bg-transparent text-ink font-sans">
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
        <div className="min-h-screen bg-transparent text-ink font-sans">
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
