import { 
    CheckCircle, 
    Smartphone, Printer, Utensils, Receipt, 
    PackagePlus, ShoppingCart, TrendingDown, BellRing, 
    Wallet, FileText, CalendarCheck, PieChart, 
    QrCode, Eye, Pointer, CreditCard, 
    LayoutDashboard, Users, Check, RefreshCw, 
    BarChart3, Activity, Target, Download, 
    Gift, Star, Heart, Award, 
    Share2, Link as LinkIcon, UserPlus, Zap
} from 'lucide-react'
import { MarketingNav, MarketingFooter, Eyebrow, MarketingButton } from '@/components/marketing'

const FEATURE_CONTENT: Record<string, any> = {
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
        ],
        cycleNodes: [
            { title: 'Take Order', desc: 'Waiters punch orders via mobile or tablet instantly.', icon: Smartphone },
            { title: 'KOT Prints', desc: 'Tickets instantly appear in the kitchen display.', icon: Printer },
            { title: 'Chef Preps', desc: 'Kitchen prepares and marks the order as ready.', icon: Utensils },
            { title: 'Serve & Bill', desc: 'Food is served and auto-synced to the final bill.', icon: Receipt }
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
        ],
        cycleNodes: [
            { title: 'Add Stock', desc: 'Log raw materials and track incoming purchases.', icon: PackagePlus },
            { title: 'Dish Sold', desc: 'A customer orders an item from your menu.', icon: ShoppingCart },
            { title: 'Auto-Deduct', desc: 'Recipe ingredients are instantly subtracted.', icon: TrendingDown },
            { title: 'Low Alert', desc: 'Get notified when it is time to reorder supplies.', icon: BellRing }
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
        ],
        cycleNodes: [
            { title: 'Sales Sync', desc: 'Daily revenue is automatically logged.', icon: Wallet },
            { title: 'Log Expenses', desc: 'Record petty cash, utilities, and vendor payouts.', icon: FileText },
            { title: 'Close Daybook', desc: 'Reconcile your cash register at the end of the shift.', icon: CalendarCheck },
            { title: 'Generate P&L', desc: 'View instant profitability reports anytime.', icon: PieChart }
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
        ],
        cycleNodes: [
            { title: 'Scan QR', desc: 'Customers scan the code placed on their table.', icon: QrCode },
            { title: 'Browse Menu', desc: 'View rich images and descriptions on their phone.', icon: Eye },
            { title: 'Place Order', desc: 'Send customized requests directly to the kitchen.', icon: Pointer },
            { title: 'Pay Online', desc: 'Settle the bill instantly via digital wallets.', icon: CreditCard }
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
        ],
        cycleNodes: [
            { title: 'Floor Layout', desc: 'Design your exact seating arrangement digitally.', icon: LayoutDashboard },
            { title: 'Seat Guests', desc: 'Assign walk-ins or reservations to open tables.', icon: Users },
            { title: 'Assign Orders', desc: 'Link KOTs and billing directly to the specific table.', icon: Check },
            { title: 'Turnover', desc: 'Clear the table in the system for the next guests.', icon: RefreshCw }
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
        ],
        cycleNodes: [
            { title: 'Collect Data', desc: 'Every order and payment is securely captured.', icon: BarChart3 },
            { title: 'Live Sync', desc: 'Data flows to your cloud dashboard in real-time.', icon: Activity },
            { title: 'Track Goals', desc: 'Monitor KPIs and top-selling items instantly.', icon: Target },
            { title: 'Export Reports', desc: 'Download tax-ready reports for your accountant.', icon: Download }
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
        ],
        cycleNodes: [
            { title: 'Guest Dines', desc: 'A customer visits and makes a purchase.', icon: Heart },
            { title: 'Earn Points', desc: 'Points are automatically credited to their profile.', icon: Star },
            { title: 'Unlock Reward', desc: 'Guest reaches a tier and gets a special discount.', icon: Award },
            { title: 'Guest Returns', desc: 'The guest comes back to redeem their reward!', icon: Gift }
        ]
    },
    'refer-earn': {
        title: 'Refer & Earn',
        subtitle: 'Grow together and get rewarded.',
        icon: '🤝',
        description: 'Love KKKhane? Share it with other restaurant owners and earn rewards for every successful referral. Help us digitize the hospitality industry and get free Premium subscription months for your effort.',
        benefits: [
            'Unique tracking referral codes',
            'Free Premium month for the referred restaurant',
            'Free Premium month for your restaurant',
            'Unlimited referral capabilities',
            'Automated reward crediting'
        ],
        ctaLabel: 'Get Your Code',
        cycleNodes: [
            { title: 'Get Link', desc: 'Generate your unique referral tracking link.', icon: LinkIcon },
            { title: 'Share', desc: 'Send it to a fellow cafe or restaurant owner.', icon: Share2 },
            { title: 'They Join', desc: 'Your friend signs up and gets a free premium month.', icon: UserPlus },
            { title: 'You Earn', desc: 'You automatically receive a free premium month too!', icon: Zap }
        ]
    }
}

export default async function FeatureSlugPage({ params }: { params: Promise<{ slug: string }> }) {
    const { slug } = await params
    const feature = FEATURE_CONTENT[slug]

    if (!feature) {
        return (
            <div className="min-h-screen bg-[#FAFAF8] text-ink font-sans">
                <MarketingNav />
                <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 pt-20 text-center">
                    <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface shadow-sm border border-hairline text-4xl">🚀</div>
                    <h1 className="mb-2 text-3xl font-extrabold tracking-tight text-ink">Feature Coming Soon</h1>
                    <p className="mb-8 max-w-md font-medium text-ink-subtle">
                        We are currently crafting this feature. Stay tuned for exciting updates!
                    </p>
                    <MarketingButton href="/">Back to Home</MarketingButton>
                </div>
                <MarketingFooter />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-[#FAFAF8] text-ink font-sans">
            <MarketingNav />

            <main className="pb-16 pt-32">
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <div className="relative overflow-hidden rounded-[2.5rem] border border-hairline bg-surface shadow-2xl">
                        {/* Decorative Backgrounds */}
                        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-gradient-to-bl from-purple-50/80 to-transparent blur-3xl" />
                        <div className="pointer-events-none absolute left-0 bottom-0 h-96 w-96 rounded-full bg-gradient-to-tr from-blue-50/80 to-transparent blur-3xl" />

                        <div className="relative z-10 p-8 sm:p-12 md:p-16 grid md:grid-cols-[1fr_400px] gap-12 items-center">
                            <div>
                                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-hairline bg-surface-muted text-3xl shadow-sm">
                                    {feature.icon}
                                </div>

                                <div className="mb-4"><Eyebrow tone="brand">Features</Eyebrow></div>
                                <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-ink md:text-5xl leading-[1.1]">
                                    {feature.title}
                                </h1>
                                <p className="mb-8 text-xl font-bold text-[var(--color-primary)]">
                                    {feature.subtitle}
                                </p>
                                <p className="mb-10 text-lg font-medium leading-relaxed text-ink-muted">
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

                            <div className="bg-surface-muted rounded-3xl p-8 border border-hairline shadow-inner h-full flex flex-col justify-center">
                                <h3 className="mb-6 text-xl font-extrabold text-ink">Key Capabilities</h3>
                                <div className="space-y-4">
                                    {feature.benefits.map((item: string, i: number) => (
                                        <div key={i} className="group flex items-start gap-4 rounded-2xl border border-hairline bg-white p-4 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md cursor-default">
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-600 shadow-inner transition-colors group-hover:bg-green-500 group-hover:text-white">
                                                <CheckCircle size={18} strokeWidth={2.5} />
                                            </div>
                                            <span className="mt-2 font-bold leading-snug text-ink-muted transition-colors group-hover:text-ink">{item}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            {/* ── Circular Architecture Section ─────────────────────────────── */}
            <section className="py-24 bg-[#FAFAF8] relative overflow-hidden">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold mb-6 tracking-tight text-ink">How it Works</h2>
                        <p className="text-xl text-ink-subtle font-medium">A seamless, interconnected cycle powering your {feature.title.toLowerCase()}.</p>
                    </div>

                    {/* Desktop Circular Diagram */}
                    <div className="hidden lg:flex relative w-full max-w-4xl mx-auto aspect-square items-center justify-center">
                        {/* Circular Track with Proper Shading */}
                        <div className="absolute inset-[15%] rounded-full border-[2px] border-dashed border-gray-300 shadow-[inset_0_0_50px_rgba(0,0,0,0.02)] animate-[spin_60s_linear_infinite_reverse]" />
                        <div className="absolute inset-[25%] rounded-full border border-gray-200 bg-white/50 shadow-[0_0_40px_rgba(0,0,0,0.03)]" />
                        
                        {/* Orbiting Particles */}
                        <div className="absolute inset-[15%] rounded-full border-2 border-transparent animate-[spin_10s_linear_infinite]">
                            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[var(--color-primary)] rounded-full shadow-[0_0_15px_var(--color-primary)]" />
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-400 rounded-full shadow-[0_0_15px_orange]" />
                        </div>

                        {/* Center Hub */}
                        <div className="relative z-10 w-48 h-48 bg-white rounded-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] flex flex-col items-center justify-center border-[8px] border-gray-50">
                            <span className="text-4xl mb-2">{feature.icon}</span>
                            <span className="text-sm font-black text-ink tracking-tight text-center px-4 leading-tight">{feature.title}</span>
                        </div>

                        {/* Nodes */}
                        {feature.cycleNodes?.map((item: any, i: number) => {
                            const positions = [
                                'top-[15%] left-1/2 -translate-x-1/2 -translate-y-1/2',
                                'top-1/2 right-[15%] translate-x-1/2 -translate-y-1/2',
                                'bottom-[15%] left-1/2 -translate-x-1/2 translate-y-1/2',
                                'top-1/2 left-[15%] -translate-x-1/2 -translate-y-1/2'
                            ]
                            return (
                                <div key={i} className={`absolute ${positions[i]} w-64 bg-white rounded-3xl p-6 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.12)] border border-hairline flex flex-col items-center text-center hover:scale-110 hover:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.15)] transition-all duration-500 z-20 group cursor-pointer`}>
                                    <div className="w-14 h-14 bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-2xl flex items-center justify-center text-ink-muted group-hover:text-[var(--color-primary)] group-hover:border-[var(--color-primary)]/30 transition-colors mb-4 shadow-sm">
                                        <item.icon size={24} />
                                    </div>
                                    <h4 className="text-base font-extrabold text-ink mb-2">{item.title}</h4>
                                    <p className="text-xs font-medium text-ink-subtle leading-relaxed">{item.desc}</p>
                                    <div className="absolute -top-3 -right-3 w-8 h-8 bg-ink text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md">
                                        0{i + 1}
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {/* Mobile Timeline Grid */}
                    <div className="lg:hidden grid gap-6 sm:grid-cols-2">
                        {feature.cycleNodes?.map((item: any, i: number) => (
                            <div key={i} className="bg-white rounded-3xl p-6 shadow-lg border border-hairline relative overflow-hidden">
                                <div className="text-[10rem] font-black text-gray-50 absolute -right-4 -bottom-12 pointer-events-none leading-none z-0">
                                    0{i + 1}
                                </div>
                                <div className="relative z-10">
                                    <div className="w-12 h-12 bg-gray-50 border border-gray-200 rounded-xl flex items-center justify-center text-[var(--color-primary)] mb-4 shadow-sm">
                                        <item.icon size={24} />
                                    </div>
                                    <h4 className="text-lg font-extrabold text-ink mb-2">{item.title}</h4>
                                    <p className="text-sm font-medium text-ink-subtle">{item.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
