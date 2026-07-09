import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import Link from 'next/link'
import Image from 'next/image'
import { MarketingNav, MarketingFooter, PricingCards } from '@/components/marketing'
import {
    QrCode, ArrowRight, BarChart3,
    Globe, CheckCircle,
    Plus, ChefHat, Receipt, LayoutDashboard
} from 'lucide-react'

const ROLE_LANDING: Record<string, string> = {
    super_admin: '/admin/dashboard',
    manager: '/admin/dashboard',
    kitchen: '/kitchen',
    waiter: '/waiter',
    onboarding: '/onboarding',
}

const faqs = [
    { q: "What is KKKhane?", a: "KKKhane is a mobile-first restaurant ordering and table management system built in Nepal — menus, KOTs, billing, and everything in between." },
    { q: "What are the features of KKKhane?", a: "Order management, digital QR menus, kitchen tickets, billing, inventory tracking, accounting, and real-time reporting. Which of these you get depends on your plan." },
    { q: "Can I use KKKhane for free?", a: "Yes. The Free plan is free forever and covers up to 100 dishes, 10 categories and 3 staff logins. No credit card required." },
    { q: "How secure is my restaurant data?", a: "Data is encrypted in transit and at rest, isolated per restaurant by row-level security, and access is governed by per-role permissions." },
    { q: "Is KKKhane available on mobile devices?", a: "Yes, you can access the platform on any device with a modern web browser, iOS or Android." },
    { q: "Do you offer a QR code menu feature?", a: "Yes. Guests scan a table QR code to browse the menu and order from their own phone, on every plan." },
]

export default async function Home() {
    const currentUser = await getOptionalUser()
    if (currentUser) {
        const landing = ROLE_LANDING[currentUser.role] || '/admin/dashboard'
        redirect(landing)
    }

    return (
        <div className="min-h-screen bg-transparent text-ink overflow-x-hidden font-sans">
            <MarketingNav />

            {/* ── SEO: JSON-LD Schema for Local Business & Software ──────────────── */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": ["SoftwareApplication", "LocalBusiness"],
                        "name": "KKKhane",
                        "url": "https://kkkhane.com",
                        "logo": "https://kkkhane.com/icons/kkkhane.png",
                        "description": "The ultimate SaaS application best from cafe to restaurants. Manage orders, inventory, and QR menus with ease.",
                        "applicationCategory": "BusinessApplication",
                        "operatingSystem": "All",
                        "email": "info.kkkhane@gmail.com",
                        "telephone": "+977-9765662427",
                        "address": {
                            "@type": "PostalAddress",
                            "addressLocality": "Bharatpur",
                            "addressRegion": "Bhojad",
                            "addressCountry": "NP"
                        }
                    })
                }}
            />

            {/* ── 1. Ultra Premium Hero Section ────────────────────────────────────────────── */}
            <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden bg-transparent">
                {/* Stunning Gradient Background */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] pointer-events-none">
                    <div className="absolute top-[20%] left-[20%] w-[500px] h-[500px] bg-[var(--color-primary)] opacity-[0.08] blur-[100px] rounded-full mix-blend-multiply animate-pulse" />
                    <div className="absolute top-[30%] right-[20%] w-[600px] h-[600px] bg-indigo-500 opacity-[0.05] blur-[120px] rounded-full mix-blend-multiply" />
                </div>
                
                <div className="max-w-[1200px] mx-auto px-4 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 bg-surface/60 backdrop-blur-md px-4 py-2 rounded-full mb-8 border border-hairline-strong/60 shadow-sm animate-fade-up">
                        <span className="flex h-2 w-2 rounded-full bg-[var(--color-primary)] animate-pulse" />
                        <span className="text-ink-muted font-bold text-sm tracking-wide">Built in Nepal 🇳🇵</span>
                    </div>

                    {/* Branding Display: "के के खाने?" from image */}
                    <div className="flex justify-center mb-6 animate-fade-up" style={{ animationDelay: '0.05s' }}>
                        <h1 lang="ne" className="text-7xl sm:text-8xl lg:text-[7rem] font-black tracking-tight cursor-default" style={{ fontFamily: 'var(--font-devanagari), var(--font-inter), sans-serif' }}>
                            <span className="text-[#201F1E] inline-block animate-[bounce_2s_infinite]">के के </span>
                            <span className="text-[#E76115] inline-block animate-[bounce_2.5s_infinite]">खाने<span className="text-[#65635B] inline-block animate-[pulse_2s_infinite]">?</span></span>
                        </h1>
                    </div>

                    <h2 className="text-3xl sm:text-5xl font-extrabold text-ink leading-[1.1] mb-8 tracking-tight animate-fade-up" style={{ animationDelay: '0.1s' }}>
                        The oldest question in every Nepali kitchen — <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-primary)] to-amber-500">and now, the answer for your restaurant.</span>
                    </h2>

                    <p className="text-lg sm:text-xl text-ink-subtle mb-12 max-w-2xl mx-auto leading-relaxed font-medium animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        KKKhane is a mobile-first restaurant ordering & table management system — menus, KOTs, billing and everything in between. Available now.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <Link href="/signup" className="w-full sm:w-auto inline-flex items-center justify-center bg-ink text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-black hover:scale-105 transition-all shadow-xl shadow-gray-900/20">
                            Get started free <ArrowRight size={20} className="ml-2" />
                        </Link>
                        <Link href="#features" className="w-full sm:w-auto inline-flex items-center justify-center bg-surface text-ink border border-hairline-strong px-8 py-4 rounded-2xl font-bold text-lg hover:bg-surface-muted hover:scale-105 transition-all shadow-sm">
                            Explore Features
                        </Link>
                    </div>

                    {/* Dashboard Hero Image */}
                    <div className="relative mt-20 max-w-5xl mx-auto animate-fade-up" style={{ animationDelay: '0.4s' }}>
                        <div className="rounded-[2.5rem] overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.12)] border-8 border-white/80 bg-surface relative aspect-[16/10] sm:aspect-video transform transition-transform hover:-translate-y-2 duration-500">
                            <Image src="/images/mockups/custom_mockup_1_hd.png" alt="Dashboard Mockup" fill className="object-cover object-top" priority sizes="(max-width: 1024px) 100vw, 1024px" quality={100} />
                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/5 to-transparent pointer-events-none" />
                        </div>
                        
                        {/* Floating elements */}
                        <div className="hidden lg:flex absolute -left-12 top-1/4 bg-surface/95 backdrop-blur-xl rounded-2xl shadow-2xl p-4 border border-white items-center gap-4 animate-float">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-green-600"><CheckCircle size={24} /></div>
                            <div className="text-left">
                                <p className="font-extrabold text-ink text-sm">Table 04 Paid</p>
                                <p className="text-xs text-ink-subtle font-medium">Rs. 1,450 via eSewa</p>
                            </div>
                        </div>
                        
                        <div className="hidden lg:flex absolute -right-8 bottom-1/4 bg-surface/95 backdrop-blur-xl rounded-2xl shadow-2xl p-4 border border-white items-center gap-4 animate-float-delayed">
                            <div className="w-12 h-12 bg-brand-100 rounded-xl flex items-center justify-center text-brand-600"><ChefHat size={24} /></div>
                            <div className="text-left">
                                <p className="font-extrabold text-ink text-sm">New KOT Sent</p>
                                <p className="text-xs text-ink-subtle font-medium">Kitchen preparing</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 2. Bento Grid Features ────────────────────────────────────────── */}
            <section id="features" className="pt-16 pb-24 bg-transparent relative">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Everything you need. <br/><span className="text-ink-subtle">Nothing you don&apos;t.</span></h2>
                        <p className="text-xl text-ink-subtle font-medium leading-relaxed">A complete ecosystem designed to automate your cafe or restaurant from front-of-house to back-office.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[320px]">
                        {/* Large bento block 1 */}
                        <div className="md:col-span-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group shadow-2xl shadow-gray-900/10 cursor-pointer">
                            <div className="absolute -top-32 -right-32 w-96 h-96 bg-[var(--color-primary)] opacity-20 blur-[100px] rounded-full group-hover:opacity-40 group-hover:scale-110 transition-all duration-700 pointer-events-none" />
                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-surface/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md border border-white/10">
                                        <LayoutDashboard className="text-white" size={28} />
                                    </div>
                                    <h3 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight">Command Center</h3>
                                    <p className="text-ink-subtle text-lg max-w-md leading-relaxed">Real-time sync between waiters, kitchen, and cashier. Watch your entire operation flow flawlessly.</p>
                                </div>
                            </div>
                        </div>

                        {/* Standard bento block 1 */}
                        <div className="bg-transparent rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline hover:border-hairline-strong transition-colors cursor-pointer">
                            <div className="h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-surface rounded-2xl shadow-sm border border-hairline flex items-center justify-center mb-6 text-[var(--color-primary)]">
                                        <QrCode size={28} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-ink mb-3 tracking-tight">Digital QR Menus</h3>
                                    <p className="text-ink-subtle font-medium leading-relaxed">Contactless ordering that updates in real-time. Hide out-of-stock items instantly.</p>
                                </div>
                            </div>
                        </div>

                        {/* Standard bento block 2 */}
                        <div className="bg-transparent rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline hover:border-hairline-strong transition-colors cursor-pointer">
                            <div className="h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-surface rounded-2xl shadow-sm border border-hairline flex items-center justify-center mb-6 text-blue-500">
                                        <BarChart3 size={28} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-ink mb-3 tracking-tight">Live Analytics</h3>
                                    <p className="text-ink-subtle font-medium leading-relaxed">Beautiful charts tracking sales, profits, and top-selling items down to the minute.</p>
                                </div>
                            </div>
                        </div>

                        {/* Large bento block 2 */}
                        <div className="md:col-span-2 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group border border-blue-100/50 cursor-pointer">
                            <div className="absolute bottom-0 right-0 w-80 h-80 bg-blue-400 opacity-10 blur-[80px] rounded-full group-hover:scale-125 transition-transform duration-700 pointer-events-none" />
                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-surface rounded-2xl shadow-sm border border-hairline flex items-center justify-center mb-6 text-indigo-600">
                                        <Receipt size={28} />
                                    </div>
                                    <h3 className="text-3xl sm:text-4xl font-extrabold text-ink mb-4 tracking-tight">IRD-Compliant Billing</h3>
                                    <p className="text-ink-muted text-lg max-w-md leading-relaxed">VAT/PAN-ready invoices with sequential, tamper-evident numbering — built to Nepal&apos;s Inland Revenue Department billing rules.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 3. Circular Architecture Section ─────────────────────────────── */}
            <section className="py-32 bg-transparent relative overflow-hidden border-y border-hairline">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                    <div className="text-center mb-24 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold mb-6 tracking-tight text-ink">The Perfect Cycle</h2>
                        <p className="text-xl text-ink-subtle font-medium">An interconnected ecosystem where every action flows seamlessly into the next.</p>
                    </div>

                    {/* Desktop Circular Diagram */}
                    <div className="hidden lg:flex relative w-full max-w-4xl mx-auto aspect-square items-center justify-center">
                        {/* Circular Track */}
                        <div className="absolute inset-[15%] rounded-full border-[2px] border-dashed border-gray-300 animate-[spin_60s_linear_infinite_reverse]" />
                        <div className="absolute inset-[25%] rounded-full border border-hairline bg-gray-50/30" />
                        
                        {/* Orbiting Particles */}
                        <div className="absolute inset-[15%] rounded-full border-2 border-transparent animate-[spin_10s_linear_infinite]">
                            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[var(--color-primary)] rounded-full shadow-[0_0_15px_var(--color-primary)]" />
                            <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-amber-400 rounded-full shadow-[0_0_15px_orange]" />
                        </div>

                        {/* Center Hub */}
                        <div className="relative z-10 w-48 h-48 bg-white rounded-full shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] flex flex-col items-center justify-center border-[8px] border-gray-50">
                            <span className="text-2xl font-black text-ink tracking-tight mb-1">KKKhane</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-primary)]">Core Sync</span>
                        </div>

                        {/* Nodes */}
                        {[
                            { step: '01', title: 'Customer Scans QR', desc: 'Instant digital menu access & order placement.', icon: QrCode, pos: 'top-[15%] left-1/2 -translate-x-1/2 -translate-y-1/2' },
                            { step: '02', title: 'Kitchen KOT', desc: 'Real-time kitchen display and ticket printing.', icon: ChefHat, pos: 'top-1/2 right-[15%] translate-x-1/2 -translate-y-1/2' },
                            { step: '03', title: 'Serve & Enjoy', desc: 'Instant waiter alerts for hot food delivery.', icon: CheckCircle, pos: 'bottom-[15%] left-1/2 -translate-x-1/2 translate-y-1/2' },
                            { step: '04', title: 'Auto Billing', desc: 'Seamless payments synced with analytics.', icon: Receipt, pos: 'top-1/2 left-[15%] -translate-x-1/2 -translate-y-1/2' },
                        ].map((item, i) => (
                            <div key={i} className={`absolute ${item.pos} w-64 bg-white rounded-3xl p-6 shadow-xl border border-hairline flex flex-col items-center text-center hover:scale-110 transition-transform duration-500 z-20 group cursor-default`}>
                                <div className="w-14 h-14 bg-gradient-to-br from-gray-50 to-gray-100 border border-hairline-strong rounded-2xl flex items-center justify-center text-ink-muted group-hover:text-[var(--color-primary)] group-hover:border-[var(--color-primary)]/30 transition-colors mb-4 shadow-sm">
                                    <item.icon size={24} />
                                </div>
                                <h4 className="text-base font-extrabold text-ink mb-2">{item.title}</h4>
                                <p className="text-xs font-medium text-ink-subtle leading-relaxed">{item.desc}</p>
                                <div className="absolute -top-3 -right-3 w-8 h-8 bg-[var(--color-primary)] text-white rounded-full flex items-center justify-center text-xs font-bold shadow-md">
                                    {item.step}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Mobile Timeline Grid */}
                    <div className="lg:hidden grid gap-6 sm:grid-cols-2">
                        {[
                            { step: '1', title: 'Customer Scans QR', desc: 'Instant digital menu access & order placement.', icon: QrCode },
                            { step: '2', title: 'Kitchen KOT', desc: 'Real-time kitchen display and ticket printing.', icon: ChefHat },
                            { step: '3', title: 'Serve & Enjoy', desc: 'Instant waiter alerts for hot food delivery.', icon: CheckCircle },
                            { step: '4', title: 'Auto Billing', desc: 'Seamless payments synced with analytics.', icon: Receipt },
                        ].map((item, i) => (
                            <div key={i} className="bg-white rounded-3xl p-6 shadow-lg border border-hairline relative overflow-hidden">
                                <div className="text-[10rem] font-black text-gray-50 absolute -right-4 -bottom-12 pointer-events-none leading-none z-0">
                                    {item.step}
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

            {/* ── 4. Cross Platform Section ─────────────────────────────────── */}
            <section className="py-24 bg-transparent">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div className="order-2 lg:order-1 relative w-full max-w-md mx-auto aspect-[3/4] bg-surface rounded-[3rem] shadow-2xl border-[12px] border-gray-900 overflow-hidden transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                            <div className="absolute top-0 inset-x-0 h-7 bg-ink rounded-b-2xl z-10 w-40 mx-auto" />
                            <Image src="/images/mockups/custom_mockup_2_hd.png" alt="Mobile View" fill className="object-cover object-top" sizes="(max-width: 768px) 80vw, 384px" quality={100} />
                        </div>
                        
                        <div className="order-1 lg:order-2 text-center lg:text-left">
                            <h3 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Available on any <span className="text-[var(--color-primary)]">device</span></h3>
                            <p className="text-lg text-ink-subtle font-medium mb-10 leading-relaxed max-w-lg mx-auto lg:mx-0">
                                Manage your cafe or restaurant from your phone, tablet, or desktop. Our cloud architecture ensures your kitchen, waitstaff, and cashier are always synced in real-time.
                            </p>

                            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4">
                                <div className="bg-black text-white px-6 py-4 rounded-2xl flex items-center gap-3 shadow-lg hover:-translate-y-1 transition-transform">
                                    <Globe size={24} className="text-[var(--color-primary)]" /> 
                                    <div className="text-left">
                                        <span className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Any OS</span>
                                        <span className="block text-sm font-bold">Web Browser</span>
                                    </div>
                                </div>
                                <div className="bg-white border border-hairline text-ink px-6 py-4 rounded-2xl flex items-center gap-3 shadow-sm hover:-translate-y-1 transition-transform">
                                    <Globe size={24} className="text-ink-subtle" /> 
                                    <div className="text-left">
                                        <span className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Mobile</span>
                                        <span className="block text-sm font-bold">iOS & Android</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── How It Works ─────────────────────────────────────────────── */}
            <section id="how-it-works" className="py-32 bg-transparent border-y border-hairline">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">
                            Setup in <span className="text-brand-500">minutes.</span>
                        </h2>
                        <p className="text-xl text-ink-subtle font-medium">Getting started is effortless. We designed it to be so intuitive, you won&apos;t need a manual.</p>
                    </div>
                    <div className="grid md:grid-cols-3 gap-10">
                        {[
                            { step: '01', title: 'Create Account', desc: 'Sign up for free. No credit card required. Instantly access your dashboard.' },
                            { step: '02', title: 'Add Menu & Staff', desc: 'Upload your items, set prices, and invite your team members with custom roles.' },
                            { step: '03', title: 'Start Taking Orders', desc: 'Generate QR codes for tables and let customers order, or use the POS.' },
                        ].map((s, i) => (
                            <div key={i} className="relative bg-surface rounded-[2.5rem] p-10 border border-hairline hover:shadow-xl hover:-translate-y-2 transition-all duration-300">
                                <span className="text-[6rem] font-black text-ink/5 absolute top-4 right-6 pointer-events-none">{s.step}</span>
                                <div className="w-14 h-14 bg-brand-100 text-brand-600 rounded-2xl flex items-center justify-center font-bold text-xl mb-8 shadow-sm">
                                    {i + 1}
                                </div>
                                <h3 className="text-2xl font-bold text-ink mb-4">{s.title}</h3>
                                <p className="text-ink-subtle font-medium leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Pricing Section ────────────────────────────────────────────── */}
            <section id="pricing" className="py-32 bg-transparent">
                <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Simple, transparent pricing.</h2>
                        <p className="text-xl text-ink-subtle font-medium">No hidden fees, no hardware lock-in. Choose the plan that fits your growth.</p>
                    </div>

                    <PricingCards />
                </div>
            </section>


            {/* ── 6. FAQ Section ─────────────────────────────────────────────── */}
            <section id="faq" className="py-24 bg-transparent">
                <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-extrabold text-ink tracking-tight">Frequently Asked Questions</h2>
                    </div>

                    <div className="space-y-4">
                        {faqs.map((faq, i) => (
                            <details key={i} className="group bg-surface border border-hairline rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                                <summary className="flex justify-between items-center font-bold text-ink cursor-pointer list-none p-6 text-lg">
                                    <span className="pr-6">{faq.q}</span>
                                    <Plus className="text-ink-subtle group-open:rotate-45 transition-transform duration-300 shrink-0" size={24} />
                                </summary>
                                <div className="px-6 pb-6 text-ink-subtle font-medium leading-relaxed">
                                    {faq.a}
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 7. CTA Banner ─────────────────────────────────────────────── */}
            <section className="py-32 bg-transparent relative overflow-hidden">
                <div className="max-w-[1200px] mx-auto px-4">
                    <div className="relative bg-ink rounded-[3rem] p-16 sm:p-24 text-center overflow-hidden shadow-2xl">
                        {/* Decorative glowing background */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[var(--color-primary)]/20 blur-[120px] rounded-full pointer-events-none" />
                        
                        <div className="relative z-10 max-w-2xl mx-auto">
                            <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight">Ready to elevate your business?</h2>
                            <p className="text-xl text-ink-subtle mb-10 font-medium">From cafes to restaurants, we serve you. Start on the free plan and upgrade whenever you outgrow it.</p>
                            <Link href="/signup" className="inline-flex items-center justify-center bg-[var(--color-primary)] text-white px-10 py-5 rounded-2xl font-extrabold text-xl hover:scale-105 transition-transform shadow-[0_0_40px_rgba(251,99,3,0.4)]">
                                Get started free
                            </Link>
                            <p className="mt-6 text-sm text-ink-subtle font-bold uppercase tracking-widest">No credit card required.</p>
                        </div>
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
