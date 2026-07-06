import { CheckCircle, ArrowRight } from 'lucide-react'
import { MarketingNav, MarketingFooter, Eyebrow, MarketingButton } from '@/components/marketing'

const FEATURE_CONTENT: Record<string, { title: string, subtitle: string, icon: string, description: string, benefits: string[], ctaLabel?: string }> = {
    'order-management': {
        title: 'Order Management with KOT',
        subtitle: 'Take orders faster and streamline the workflow from table to kitchen.',
        icon: '📝',
        description: 'Perfect for cafés, fine-dine restaurants, bars, or cloud kitchens. Keep everything digital and synchronized instantly. Orders from waiters and QR codes instantly appear on the KDS (Kitchen Display System), tracking prep times and eliminating lost paper tickets.',
        benefits: [
            'Digital KOTs directly to the kitchen display',
            'Real-time order status tracking',
            'Dine-in, Takeaway, and Delivery queues',
            'Reduce waiter workload and paper waste',
            'Split or merge bills effortlessly'
        ]
    },
    'inventory': {
        title: 'Inventory & Waste Control',
        subtitle: 'Know your stock before it runs out.',
        icon: '📦',
        description: 'Keep track of raw materials, manage suppliers, and automate low-stock alerts so you never run out of your best-selling ingredients. Every time a dish is sold, the exact ingredients are automatically deducted based on your saved recipes.',
        benefits: [
            'Real-time recipe-based ingredient deduction',
            'Automated low stock email & SMS alerts',
            'Supplier ledger and purchase order tracking',
            'Waste and breakage logging',
            'Multi-location inventory tracking'
        ]
    },
    'accounting': {
        title: 'Accounting & Expense Manager',
        subtitle: 'Track every rupee that flows in and out of your restaurant.',
        icon: '💰',
        description: 'Stop using messy spreadsheets. Get a built-in expense tracker that connects directly to your sales data. Manage petty cash, supplier payments, utility bills, and instantly generate profit and loss statements.',
        benefits: [
            'Automated Daybook (Daily Closing) generation',
            'Supplier and vendor ledger management',
            'Instant Profit & Loss statements',
            'Petty cash and daily expense logging',
            'Exportable financial data for your accountant'
        ]
    },
    'qr-menu': {
        title: 'Digital QR Menu',
        subtitle: 'Scan, order, and pay without waiting for a menu.',
        icon: '📱',
        description: 'Transform your dining experience with instant digital menus. Guests simply scan a QR code placed on their table to browse your full menu with images, customize their orders, and send them straight to the kitchen.',
        benefits: [
            'No app download required for customers',
            'Instantly hide out-of-stock items',
            'Showcase high-quality images and descriptions',
            'Accept payments directly via eSewa, Khalti, or Fonepay',
            'Increase average order value through visual upselling'
        ]
    },
    'table-management': {
        title: 'Menu & Table Management',
        subtitle: 'Organize your floor plan and control your offerings.',
        icon: '🪑',
        description: 'Design your restaurant floor plan visually. Assign orders to specific tables, track table turnover times, and easily switch menus for different times of the day (Breakfast, Lunch, Happy Hour).',
        benefits: [
            'Visual drag-and-drop table layout editor',
            'Live table status (Available, Seated, Ordered, Billed)',
            'Dynamic pricing for Happy Hours',
            'Unlimited categories, sub-menus, and add-ons',
            'Table reservation management'
        ]
    },
    'analytics': {
        title: 'Real-Time Sales Report',
        subtitle: 'Watch your sales grow in real-time from anywhere.',
        icon: '📈',
        description: 'Stop guessing how your restaurant is performing. Get real-time dashboards showing your revenue, top-selling items, busiest hours, and staff performance. Accessible from your phone no matter where you are.',
        benefits: [
            'Real-time 7-day trend charts',
            'Top selling items and dead stock analysis',
            'Busiest hours forecasting',
            'Staff performance and sales metrics',
            'Custom date-range comparisons'
        ]
    },
    'loyalty': {
        title: 'Loyalty & Rewards',
        subtitle: 'Turn first-time guests into regulars.',
        icon: '🎁',
        description: 'Build a loyal customer base with our automated rewards system. Let customers earn points on every purchase and automatically send them special discounts or birthday bonuses to keep them coming back.',
        benefits: [
            'Automated points earn and redeem rules',
            'Customizable membership tiers (Gold, Platinum)',
            'Birthday bonuses and automated SMS alerts',
            'Detailed customer CRM profiles',
            'Targeted discount campaigns'
        ]
    },
    'refer-earn': {
        title: 'Refer & Earn',
        subtitle: 'Grow together and get rewarded.',
        icon: '🤝',
        description: 'Love kkkhane? Share it with other restaurant owners and earn rewards for every successful referral. Help us digitize the hospitality industry and get free Premium subscription months for your effort.',
        benefits: [
            'Unique tracking referral codes',
            'Free Premium month for the referred restaurant',
            'Free Premium month for your restaurant',
            'Unlimited referral capabilities',
            'Automated reward crediting'
        ],
        ctaLabel: 'Get Your Code'
    }
}

export default async function FeatureSlugPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const feature = FEATURE_CONTENT[slug]

    if (!feature) {
        return (
            <div className="min-h-screen bg-[#FAFAF8] text-gray-900 font-sans">
                <MarketingNav />
                <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 pt-20 text-center">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-white shadow-sm border border-gray-100 text-4xl">🔍</div>
                    <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-gray-900">Feature Not Found</h1>
                    <p className="mb-8 max-w-md font-medium text-gray-500">
                        We couldn&apos;t find the specific feature you&apos;re looking for.
                    </p>
                    <MarketingButton href="/">Back to Home</MarketingButton>
                </div>
                <MarketingFooter />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#FAFAF8] text-gray-900 font-sans">
            <MarketingNav />

            <main className="pb-24 pt-32">
                <div className="mx-auto max-w-5xl px-4 sm:px-6">
                    <div className="relative overflow-hidden rounded-[2.5rem] border border-gray-100 bg-white shadow-2xl">
                        {/* Decorative Backgrounds */}
                        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-gradient-to-bl from-purple-50/80 to-transparent blur-3xl" />
                        <div className="pointer-events-none absolute left-0 bottom-0 h-96 w-96 rounded-full bg-gradient-to-tr from-blue-50/80 to-transparent blur-3xl" />

                        <div className="relative z-10 p-8 sm:p-12 md:p-16 grid md:grid-cols-[1fr_400px] gap-12 items-center">
                            <div>
                                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-gray-100 bg-gray-50 text-3xl shadow-sm">
                                    {feature.icon}
                                </div>

                                <div className="mb-4"><Eyebrow tone="brand">Features</Eyebrow></div>
                                <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-gray-900 md:text-5xl leading-[1.1]">
                                    {feature.title}
                                </h1>
                                <p className="mb-8 text-xl font-bold text-[var(--color-primary)]">
                                    {feature.subtitle}
                                </p>
                                <p className="mb-10 text-lg font-medium leading-relaxed text-gray-600">
                                    {feature.description}
                                </p>

                                <div className="flex flex-col sm:flex-row gap-4">
                                    <MarketingButton href="/signup" size="lg" className="w-full sm:w-auto">
                                        {feature.ctaLabel || 'Start Free Trial'}
                                    </MarketingButton>
                                    <MarketingButton href="/pricing" size="lg" variant="secondary" className="w-full sm:w-auto">
                                        View Pricing
                                    </MarketingButton>
                                </div>
                            </div>

                            <div className="bg-gray-50 rounded-3xl p-8 border border-gray-100 shadow-inner h-full flex flex-col justify-center">
                                <h3 className="mb-6 text-xl font-extrabold text-gray-900">Key Capabilities</h3>
                                <ul className="space-y-5">
                                    {feature.benefits.map((item, i) => (
                                        <li key={i} className="flex items-start gap-4 font-medium text-gray-700">
                                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 mt-0.5">
                                                <CheckCircle size={14} className="text-green-600" strokeWidth={3} />
                                            </div>
                                            <span className="leading-snug">{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <MarketingFooter />
        </div>
    )
}
