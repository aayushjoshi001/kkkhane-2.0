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
    { q: "What is kkkhane?", a: "kkkhane is a mobile-first restaurant ordering and table management system built in Nepal — menus, KOTs, billing, and everything in between." },
    { q: "What are the features of kkkhane?", a: "Order management, digital QR menus, kitchen tickets, billing, inventory tracking, accounting, and real-time reporting. Which of these you get depends on your plan." },
    { q: "Can I use kkkhane for free?", a: "Yes. The Free plan is free forever and covers up to 100 dishes, 10 categories and 3 staff logins. No credit card required." },
    { q: "How secure is my restaurant data?", a: "Data is encrypted in transit and at rest, isolated per restaurant by row-level security, and access is governed by per-role permissions." },
    { q: "Is kkkhane available on mobile devices?", a: "Yes, you can access the platform on any device with a modern web browser." },
    { q: "Do you offer a QR code menu feature?", a: "Yes. Guests scan a table QR code to browse the menu and order from their own phone, on every plan." },
]

export default async function Home() {
    const currentUser = await getOptionalUser()
    if (currentUser) {
        const landing = ROLE_LANDING[currentUser.role] || '/admin/dashboard'
        redirect(landing)
    }

    return (
        <div className="min-h-screen bg-surface text-ink overflow-x-hidden font-sans">
            <MarketingNav />

            {/* ── 1. Ultra Premium Hero Section ────────────────────────────────────────────── */}
            <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden bg-[#FAFAF8]">
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

                    <p
                        className="font-[family-name:var(--font-devanagari)] text-4xl sm:text-5xl font-bold text-[var(--color-primary)] mb-4 animate-fade-up"
                        lang="ne"
                    >
                        के के खाने?
                    </p>

                    <h1 className="text-5xl sm:text-7xl lg:text-[5.5rem] font-extrabold text-ink leading-[1.05] mb-8 tracking-tight animate-fade-up" style={{ animationDelay: '0.1s' }}>
                        Run your restaurant <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-primary)] to-amber-500">beautifully.</span>
                    </h1>

                    <p className="text-lg sm:text-xl text-ink-subtle mb-12 max-w-2xl mx-auto leading-relaxed font-medium animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        A mobile-first restaurant ordering and table management system. Menus, KOTs, billing, and everything in between.
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
                            <Image src="/images/mockups/dashboard_mockup_1782036296571.png" alt="Dashboard Mockup" fill className="object-cover" priority sizes="(max-width: 1024px) 100vw, 1024px" />
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
            <section id="features" className="py-32 bg-surface relative">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Everything you need. <br/><span className="text-ink-subtle">Nothing you don&apos;t.</span></h2>
                        <p className="text-xl text-ink-subtle font-medium leading-relaxed">A complete ecosystem designed to automate your restaurant from front-of-house to back-office.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[320px]">
                        {/* Large bento block 1 */}
                        <div className="md:col-span-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group shadow-2xl shadow-gray-900/10">
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
                        <div className="bg-[#FAFAF8] rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline hover:border-hairline-strong transition-colors">
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
                        <div className="bg-[#FAFAF8] rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline hover:border-hairline-strong transition-colors">
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
                        <div className="md:col-span-2 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group border border-blue-100/50">
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

            {/* ── 4. Cross Platform Section ─────────────────────────────────── */}
            <section className="py-24 bg-[#FAFAF8]">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="grid lg:grid-cols-2 gap-16 items-center">
                        <div className="order-2 lg:order-1 relative w-full max-w-md mx-auto aspect-[3/4] bg-surface rounded-[3rem] shadow-2xl border-[12px] border-gray-900 overflow-hidden transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                            <div className="absolute top-0 inset-x-0 h-7 bg-ink rounded-b-2xl z-10 w-40 mx-auto" />
                            <Image src="/images/mockups/dashboard_mockup_1782036296571.png" alt="Mobile View" fill className="object-cover object-left" sizes="(max-width: 768px) 80vw, 384px" />
                        </div>
                        
                        <div className="order-1 lg:order-2 text-center lg:text-left">
                            <h3 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Available on any <span className="text-[var(--color-primary)]">device</span></h3>
                            <p className="text-lg text-ink-subtle font-medium mb-12 leading-relaxed max-w-lg mx-auto lg:mx-0">
                                Manage your business from your phone, tablet, or desktop. Our cloud architecture ensures you are always synced across all your devices in real-time.
                            </p>

                                <div className="bg-black text-white px-8 py-4 rounded-2xl flex items-center justify-center gap-3 shadow-lg">
                                    <Globe size={24} className="text-[var(--color-primary)]" /> 
                                    <div className="text-left">
                                        <span className="block text-[10px] font-bold text-ink-subtle uppercase tracking-wider">Access Anywhere</span>
                                        <span className="block text-sm font-bold">Web Browser</span>
                                    </div>
                                </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── How It Works ─────────────────────────────────────────────── */}
            <section id="how-it-works" className="py-32 bg-surface border-y border-hairline">
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
                            <div key={i} className="relative bg-[#FAFAF8] rounded-[2.5rem] p-10 border border-hairline hover:shadow-xl hover:-translate-y-2 transition-all duration-300">
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
            <section id="pricing" className="py-32 bg-[#FAFAF8]">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-ink mb-6 tracking-tight">Simple, transparent pricing.</h2>
                        <p className="text-xl text-ink-subtle font-medium">No hidden fees, no hardware lock-in. Choose the plan that fits your growth.</p>
                    </div>

                    <PricingCards />
                </div>
            </section>


            {/* ── 6. FAQ Section ─────────────────────────────────────────────── */}
            <section id="faq" className="py-24 bg-surface">
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
            <section className="py-32 bg-surface relative overflow-hidden">
                <div className="max-w-[1200px] mx-auto px-4">
                    <div className="relative bg-ink rounded-[3rem] p-16 sm:p-24 text-center overflow-hidden shadow-2xl">
                        {/* Decorative glowing background */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[var(--color-primary)]/20 blur-[120px] rounded-full pointer-events-none" />
                        
                        <div className="relative z-10 max-w-2xl mx-auto">
                            <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight">Ready to elevate your restaurant?</h2>
                            <p className="text-xl text-ink-subtle mb-10 font-medium">Start on the free plan and upgrade whenever you outgrow it.</p>

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
