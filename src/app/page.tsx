import { redirect } from 'next/navigation'
import { getOptionalUser } from '@/lib/auth'
import Link from 'next/link'
import Image from 'next/image'
import { MarketingNav, MarketingFooter } from '@/components/marketing'
import {
    QrCode, ArrowRight, BarChart3,
    Globe, CheckCircle,
    Star, Plus, ChefHat, Receipt, LayoutDashboard
} from 'lucide-react'

const ROLE_LANDING: Record<string, string> = {
    super_admin: '/admin/dashboard',
    manager: '/admin/dashboard',
    kitchen: '/kitchen',
    waiter: '/waiter',
    onboarding: '/onboarding',
}

const faqs = [
    { q: "What is kkkhane?", a: "kkkhane Nepal is an ultra-premium restaurant management software with smart features to run and manage all the operations of your restaurant flawlessly." },
    { q: "What are the features of kkkhane?", a: "It provides robust features including Order Management, Inventory Tracking, Accounting, Digital QR Menu, and Real-Time Reporting." },
    { q: "Can I use the kkkhane software for free?", a: "Yes, we offer a completely free tier with essential tools for small businesses." },
    { q: "How secure is my restaurant data?", a: "We use top-tier cloud encryption and role-based access control to ensure complete security." },
    { q: "Is kkkhane Nepal available on mobile devices?", a: "Yes, you can access our platform on any device with a modern web browser." },
    { q: "Do you offer a QR code menu feature?", a: "Absolutely. Our digital QR menus allow contactless ordering seamlessly." },
]

export default async function Home() {
    const currentUser = await getOptionalUser()
    if (currentUser) {
        const landing = ROLE_LANDING[currentUser.role] || '/admin/dashboard'
        redirect(landing)
    }

    return (
        <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden font-sans">
            <MarketingNav />

            {/* ── 1. Ultra Premium Hero Section ────────────────────────────────────────────── */}
            <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden bg-[#FAFAF8]">
                {/* Stunning Gradient Background */}
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[800px] pointer-events-none">
                    <div className="absolute top-[20%] left-[20%] w-[500px] h-[500px] bg-[var(--color-primary)] opacity-[0.08] blur-[100px] rounded-full mix-blend-multiply animate-pulse" />
                    <div className="absolute top-[30%] right-[20%] w-[600px] h-[600px] bg-indigo-500 opacity-[0.05] blur-[120px] rounded-full mix-blend-multiply" />
                </div>
                
                <div className="max-w-[1200px] mx-auto px-4 relative z-10 text-center">
                    <div className="inline-flex items-center gap-2 bg-white/60 backdrop-blur-md px-4 py-2 rounded-full mb-8 border border-gray-200/60 shadow-sm animate-fade-up">
                        <span className="flex h-2 w-2 rounded-full bg-[var(--color-primary)] animate-pulse" />
                        <span className="text-gray-700 font-bold text-sm tracking-wide">The New Standard for Nepali Restaurants 🇳🇵</span>
                    </div>

                    <h1 className="text-5xl sm:text-7xl lg:text-[5.5rem] font-extrabold text-gray-900 leading-[1.05] mb-8 tracking-tight animate-fade-up" style={{ animationDelay: '0.1s' }}>
                        Run your restaurant <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--color-primary)] to-amber-500">beautifully.</span>
                    </h1>

                    <p className="text-lg sm:text-xl text-gray-500 mb-12 max-w-2xl mx-auto leading-relaxed font-medium animate-fade-up" style={{ animationDelay: '0.2s' }}>
                        An ultra-premium OS that handles orders, inventory, billing, and staff. Elevate your dining experience with world-class technology.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-fade-up" style={{ animationDelay: '0.3s' }}>
                        <Link href="/signup" className="w-full sm:w-auto inline-flex items-center justify-center bg-gray-900 text-white px-8 py-4 rounded-2xl font-bold text-lg hover:bg-black hover:scale-105 transition-all shadow-xl shadow-gray-900/20">
                            Start 14-Day Free Trial <ArrowRight size={20} className="ml-2" />
                        </Link>
                        <Link href="#features" className="w-full sm:w-auto inline-flex items-center justify-center bg-white text-gray-900 border border-gray-200 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-50 hover:scale-105 transition-all shadow-sm">
                            Explore Features
                        </Link>
                    </div>

                    {/* Dashboard Hero Image */}
                    <div className="relative mt-20 max-w-5xl mx-auto animate-fade-up" style={{ animationDelay: '0.4s' }}>
                        <div className="rounded-[2.5rem] overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.12)] border-8 border-white/80 bg-white relative aspect-[16/10] sm:aspect-video transform transition-transform hover:-translate-y-2 duration-500">
                            <Image src="/images/mockups/dashboard_mockup_1782036296571.png" alt="Dashboard Mockup" fill className="object-cover" priority sizes="(max-width: 1024px) 100vw, 1024px" />
                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/5 to-transparent pointer-events-none" />
                        </div>
                        
                        {/* Floating elements */}
                        <div className="hidden lg:flex absolute -left-12 top-1/4 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl p-4 border border-white items-center gap-4 animate-float">
                            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center text-green-600"><CheckCircle size={24} /></div>
                            <div className="text-left">
                                <p className="font-extrabold text-gray-900 text-sm">Table 04 Paid</p>
                                <p className="text-xs text-gray-500 font-medium">Rs. 1,450 via eSewa</p>
                            </div>
                        </div>
                        
                        <div className="hidden lg:flex absolute -right-8 bottom-1/4 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl p-4 border border-white items-center gap-4 animate-float-delayed">
                            <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center text-orange-600"><ChefHat size={24} /></div>
                            <div className="text-left">
                                <p className="font-extrabold text-gray-900 text-sm">New KOT Sent</p>
                                <p className="text-xs text-gray-500 font-medium">Kitchen preparing</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 2. Client Logo Marquee ─────────────────────────────────────── */}
            <section className="py-12 border-b border-gray-100 bg-white overflow-hidden">
                <p className="text-center text-gray-400 font-bold tracking-wide uppercase text-xs mb-8">Trusted by 7,500+ restaurants of all sizes</p>
                <div className="relative flex overflow-x-hidden group opacity-60">
                    <div className="animate-marquee flex whitespace-nowrap items-center gap-24 px-12 text-gray-800 font-black text-2xl uppercase tracking-widest">
                        {['Cafe Mocha', 'The Pizza Hub', 'Himalayan Grill', 'Kathmandu Kitchen', 'Spice Route', 'Urban Burger', 'Everest Dine', 'Bistro Nepal'].map(logo => (
                            <span key={logo} className="hover:text-[var(--color-primary)] transition-colors cursor-pointer">{logo}</span>
                        ))}
                    </div>
                    <div className="absolute top-0 animate-marquee2 flex whitespace-nowrap items-center gap-24 px-12 text-gray-800 font-black text-2xl uppercase tracking-widest">
                        {['Cafe Mocha', 'The Pizza Hub', 'Himalayan Grill', 'Kathmandu Kitchen', 'Spice Route', 'Urban Burger', 'Everest Dine', 'Bistro Nepal'].map(logo => (
                            <span key={logo + '2'} className="hover:text-[var(--color-primary)] transition-colors cursor-pointer">{logo}</span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 3. Bento Grid Features ────────────────────────────────────────── */}
            <section id="features" className="py-32 bg-white relative">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">Everything you need. <br/><span className="text-gray-400">Nothing you don&apos;t.</span></h2>
                        <p className="text-xl text-gray-500 font-medium leading-relaxed">A complete ecosystem designed to automate your restaurant from front-of-house to back-office.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-[320px]">
                        {/* Large bento block 1 */}
                        <div className="md:col-span-2 bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group shadow-2xl shadow-gray-900/10">
                            <div className="absolute -top-32 -right-32 w-96 h-96 bg-[var(--color-primary)] opacity-20 blur-[100px] rounded-full group-hover:opacity-40 group-hover:scale-110 transition-all duration-700 pointer-events-none" />
                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md border border-white/10">
                                        <LayoutDashboard className="text-white" size={28} />
                                    </div>
                                    <h3 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 tracking-tight">Command Center</h3>
                                    <p className="text-gray-400 text-lg max-w-md leading-relaxed">Real-time sync between waiters, kitchen, and cashier. Watch your entire operation flow flawlessly.</p>
                                </div>
                            </div>
                        </div>

                        {/* Standard bento block 1 */}
                        <div className="bg-[#FAFAF8] rounded-[2.5rem] p-10 relative overflow-hidden group border border-gray-100 hover:border-gray-200 transition-colors">
                            <div className="h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-6 text-[var(--color-primary)]">
                                        <QrCode size={28} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Digital QR Menus</h3>
                                    <p className="text-gray-500 font-medium leading-relaxed">Contactless ordering that updates in real-time. Hide out-of-stock items instantly.</p>
                                </div>
                            </div>
                        </div>

                        {/* Standard bento block 2 */}
                        <div className="bg-[#FAFAF8] rounded-[2.5rem] p-10 relative overflow-hidden group border border-gray-100 hover:border-gray-200 transition-colors">
                            <div className="h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-6 text-blue-500">
                                        <BarChart3 size={28} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-gray-900 mb-3 tracking-tight">Live Analytics</h3>
                                    <p className="text-gray-500 font-medium leading-relaxed">Beautiful charts tracking sales, profits, and top-selling items down to the minute.</p>
                                </div>
                            </div>
                        </div>

                        {/* Large bento block 2 */}
                        <div className="md:col-span-2 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-[2.5rem] p-10 sm:p-12 relative overflow-hidden group border border-blue-100/50">
                            <div className="absolute bottom-0 right-0 w-80 h-80 bg-blue-400 opacity-10 blur-[80px] rounded-full group-hover:scale-125 transition-transform duration-700 pointer-events-none" />
                            <div className="relative z-10 h-full flex flex-col justify-between">
                                <div>
                                    <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-gray-100 flex items-center justify-center mb-6 text-indigo-600">
                                        <Receipt size={28} />
                                    </div>
                                    <h3 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4 tracking-tight">IRD Approved Billing</h3>
                                    <p className="text-gray-600 text-lg max-w-md leading-relaxed">Generate legal, VAT/PAN compliant invoices in seconds. Fully approved by the Inland Revenue Department of Nepal.</p>
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
                        <div className="order-2 lg:order-1 relative w-full max-w-md mx-auto aspect-[3/4] bg-white rounded-[3rem] shadow-2xl border-[12px] border-gray-900 overflow-hidden transform -rotate-3 hover:rotate-0 transition-transform duration-500">
                            <div className="absolute top-0 inset-x-0 h-7 bg-gray-900 rounded-b-2xl z-10 w-40 mx-auto" />
                            <Image src="/images/mockups/dashboard_mockup_1782036296571.png" alt="Mobile View" fill className="object-cover object-left" sizes="(max-width: 768px) 80vw, 384px" />
                        </div>
                        
                        <div className="order-1 lg:order-2 text-center lg:text-left">
                            <h3 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">Available on any <span className="text-[var(--color-primary)]">device</span></h3>
                            <p className="text-lg text-gray-500 font-medium mb-12 leading-relaxed max-w-lg mx-auto lg:mx-0">
                                Manage your business from your phone, tablet, or desktop. Our cloud architecture ensures you are always synced across all your devices in real-time.
                            </p>

                                <div className="bg-black text-white px-8 py-4 rounded-2xl flex items-center justify-center gap-3 shadow-lg">
                                    <Globe size={24} className="text-[var(--color-primary)]" /> 
                                    <div className="text-left">
                                        <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">Access Anywhere</span>
                                        <span className="block text-sm font-bold">Web Browser</span>
                                    </div>
                                </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── How It Works ─────────────────────────────────────────────── */}
            <section id="how-it-works" className="py-32 bg-white border-y border-gray-100">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">
                            Setup in <span className="text-brand-500">minutes.</span>
                        </h2>
                        <p className="text-xl text-gray-500 font-medium">Getting started is effortless. We designed it to be so intuitive, you won&apos;t need a manual.</p>
                    </div>
                    <div className="grid md:grid-cols-3 gap-10">
                        {[
                            { step: '01', title: 'Create Account', desc: 'Sign up for free. No credit card required. Instantly access your dashboard.' },
                            { step: '02', title: 'Add Menu & Staff', desc: 'Upload your items, set prices, and invite your team members with custom roles.' },
                            { step: '03', title: 'Start Taking Orders', desc: 'Generate QR codes for tables and let customers order, or use the POS.' },
                        ].map((s, i) => (
                            <div key={i} className="relative bg-[#FAFAF8] rounded-[2.5rem] p-10 border border-gray-100 hover:shadow-xl hover:-translate-y-2 transition-all duration-300">
                                <span className="text-[6rem] font-black text-gray-900/5 absolute top-4 right-6 pointer-events-none">{s.step}</span>
                                <div className="w-14 h-14 bg-brand-100 text-brand-600 rounded-2xl flex items-center justify-center font-bold text-xl mb-8 shadow-sm">
                                    {i + 1}
                                </div>
                                <h3 className="text-2xl font-bold text-gray-900 mb-4">{s.title}</h3>
                                <p className="text-gray-500 font-medium leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 5. Testimonials Masonry ────────────────────────────────────── */}
            <section className="py-32 bg-white">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">
                            Loved by the best.
                        </h2>
                        <p className="text-xl text-gray-500 font-medium">Stories, feedback, and experiences shared by businesses growing with our software.</p>
                    </div>

                    <div className="columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6">
                        {[
                            { name: "Prakash Shrestha", role: "Owner", text: "I have been using this app since a year now. I like all features. It is simple to setup and it helps me to take orders from customers. The main features I liked of this app is, <highlight>customer can scan qr code and oder from their phone</highlight> which best... UI is nice" },
                            { name: "Shrutika Gurung", role: "Cafe Owner", text: "As a cafe owner in Nepal, kkkhane has been a game-changer for my daily operations. Order taking, billing, stock tracking—sabal kura ekdam sajilo bhayo. <highlight>Customers love the QR menu</highlight>, and the support team is quick." },
                            { name: "Raj Kumar Gurung", role: "Owner", text: "The dashboard is clean and easy to understand. <highlight>I love how I can see daily reports and trends at a glance.</highlight> really helps me plan ahead." },
                            { name: "Darshan Thapa", role: "Owner", text: "I've been using this POS software for my two cafés, and it's been a great experience so far. The system is <highlight>easy to use, with a clean and minimal interface</highlight> that makes daily operations smooth." },
                            { name: "Celina Dangol", role: "Owner", text: "What I love most is I don't need extra hardware. <highlight>I can manage everything on my phone.</highlight> It's the most flexible restaurant management software in Nepal." },
                            { name: "Anup Gautam", role: "Owner", text: "<highlight>No more paper menus or miscommunication.</highlight> Our customers love the QR code menu and easy ordering. keeps everything digital and efficient." }
                        ].map((r, i) => (
                            <div key={i} className="break-inside-avoid bg-[#FAFAF8] p-8 rounded-[2rem] border border-gray-100 hover:border-gray-200 transition-colors">
                                <div className="flex justify-between items-start mb-6">
                                    <div className="flex gap-4 items-center">
                                        <div className="w-12 h-12 rounded-full bg-gray-900 flex items-center justify-center font-bold text-white text-lg uppercase shadow-sm">
                                            {r.name.substring(0, 2)}
                                        </div>
                                        <div>
                                            <h5 className="font-bold text-gray-900">{r.name}</h5>
                                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{r.role}</p>
                                        </div>
                                    </div>
                                    <Globe size={18} className="text-gray-300" />
                                </div>
                                <div className="flex gap-1 mb-6 text-amber-400">
                                    {[...Array(5)].map((_, idx) => <Star key={idx} size={14} fill="currentColor" />)}
                                </div>
                                <p className="text-gray-600 text-balance font-medium leading-relaxed text-sm" dangerouslySetInnerHTML={{
                                    __html: r.text.replace(/<highlight>(.*?)<\/highlight>/g, '<span class="bg-[var(--color-primary)]/10 text-[var(--color-primary)] px-1.5 py-0.5 rounded font-bold">$1</span>')
                                }} />
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Pricing Section ────────────────────────────────────────────── */}
            <section id="pricing" className="py-32 bg-[#FAFAF8]">
                <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-20 max-w-3xl mx-auto">
                        <h2 className="text-4xl sm:text-5xl font-extrabold text-gray-900 mb-6 tracking-tight">Simple, transparent pricing.</h2>
                        <p className="text-xl text-gray-500 font-medium">No hidden fees, no hardware lock-in. Choose the plan that fits your growth.</p>
                    </div>

                    <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                        {/* Free Tier */}
                        <div className="bg-white rounded-[2.5rem] p-10 border border-gray-200 hover:border-gray-300 transition-all hover:shadow-xl flex flex-col">
                            <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Free Starter</h3>
                            <p className="text-gray-500 font-medium mb-6">Perfect for small food stalls or testing the waters.</p>
                            <div className="mb-8">
                                <span className="text-5xl font-black text-gray-900">Free</span>
                            </div>
                            <ul className="space-y-4 mb-10 flex-1">
                                {['Up to 1 Staff Member (Owner)', 'Max 20 Menu Items', 'Basic POS Features', 'Standard Email Support'].map((f, i) => (
                                    <li key={i} className="flex items-center gap-3 font-medium text-gray-700">
                                        <CheckCircle className="text-brand-500 shrink-0" size={20} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            <Link href="/signup" className="w-full text-center bg-gray-50 text-gray-900 font-bold py-4 rounded-2xl border border-gray-200 hover:bg-gray-100 transition-colors">
                                Start for Free
                            </Link>
                        </div>

                        {/* Pro Tier */}
                        <div className="bg-gray-900 rounded-[2.5rem] p-10 border border-gray-800 hover:border-gray-700 transition-all hover:shadow-2xl shadow-xl shadow-gray-900/20 relative flex flex-col overflow-hidden transform md:scale-105 z-10">
                            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500 opacity-20 blur-[80px] rounded-full pointer-events-none" />
                            <div className="absolute top-6 right-8 bg-brand-500 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Most Popular</div>
                            <h3 className="text-2xl font-extrabold text-white mb-2">Pro Business</h3>
                            <p className="text-gray-400 font-medium mb-6">Everything you need to run and scale a growing restaurant.</p>
                            <div className="mb-8 flex items-end gap-2">
                                <span className="text-5xl font-black text-white">Rs. 14,400</span>
                                <span className="text-gray-400 font-medium mb-2">/year</span>
                            </div>
                            <ul className="space-y-4 mb-10 flex-1">
                                {['Unlimited Staff & Roles', 'Unlimited Menu Items', 'Kitchen Display System (KDS)', 'Advanced Analytics & Reports', 'Priority 24/7 Support'].map((f, i) => (
                                    <li key={i} className="flex items-center gap-3 font-medium text-gray-300">
                                        <CheckCircle className="text-brand-400 shrink-0" size={20} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            <Link href="/signup" className="w-full text-center bg-brand-500 text-white font-extrabold py-4 rounded-2xl hover:bg-brand-400 transition-colors shadow-lg shadow-brand-500/20">
                                Start 14-Day Free Trial
                            </Link>
                        </div>

                        {/* Enterprise Tier */}
                        <div className="bg-white rounded-[2.5rem] p-10 border border-gray-200 hover:border-gray-300 transition-all hover:shadow-xl flex flex-col">
                            <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Enterprise</h3>
                            <p className="text-gray-500 font-medium mb-6">Tailored solutions for franchises and large chains.</p>
                            <div className="mb-8 flex items-end gap-2">
                                <span className="text-5xl font-black text-gray-900">Custom</span>
                            </div>
                            <ul className="space-y-4 mb-10 flex-1">
                                {['Multi-Location Management', 'Custom POS Hardware', 'Dedicated Account Manager', 'On-site Training & Setup', 'Custom Feature Dev'].map((f, i) => (
                                    <li key={i} className="flex items-center gap-3 font-medium text-gray-700">
                                        <CheckCircle className="text-brand-500 shrink-0" size={20} />
                                        {f}
                                    </li>
                                ))}
                            </ul>
                            <Link href="mailto:enterprise@kkkhane.com" className="w-full text-center bg-gray-50 text-gray-900 font-bold py-4 rounded-2xl border border-gray-200 hover:bg-gray-100 transition-colors">
                                Contact Sales
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── 6. FAQ Section ─────────────────────────────────────────────── */}
            <section id="faq" className="py-24 bg-white">
                <div className="max-w-[900px] mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-extrabold text-gray-900 tracking-tight">Frequently Asked Questions</h2>
                    </div>

                    <div className="space-y-4">
                        {faqs.map((faq, i) => (
                            <details key={i} className="group bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                                <summary className="flex justify-between items-center font-bold text-gray-900 cursor-pointer list-none p-6 text-lg">
                                    <span className="pr-6">{faq.q}</span>
                                    <Plus className="text-gray-400 group-open:rotate-45 transition-transform duration-300 shrink-0" size={24} />
                                </summary>
                                <div className="px-6 pb-6 text-gray-500 font-medium leading-relaxed">
                                    {faq.a}
                                </div>
                            </details>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── 7. CTA Banner ─────────────────────────────────────────────── */}
            <section className="py-32 bg-white relative overflow-hidden">
                <div className="max-w-[1200px] mx-auto px-4">
                    <div className="relative bg-gray-900 rounded-[3rem] p-16 sm:p-24 text-center overflow-hidden shadow-2xl">
                        {/* Decorative glowing background */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[var(--color-primary)]/20 blur-[120px] rounded-full pointer-events-none" />
                        
                        <div className="relative z-10 max-w-2xl mx-auto">
                            <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight">Ready to elevate your restaurant?</h2>
                            <p className="text-xl text-gray-400 mb-10 font-medium">Join thousands of restaurants running their operations on our modern platform.</p>
                            
                            <Link href="/signup" className="inline-flex items-center justify-center bg-[var(--color-primary)] text-white px-10 py-5 rounded-2xl font-extrabold text-xl hover:scale-105 transition-transform shadow-[0_0_40px_rgba(251,99,3,0.4)]">
                                Start your free trial today
                            </Link>
                            <p className="mt-6 text-sm text-gray-500 font-bold uppercase tracking-widest">No credit card required. Setup in 2 minutes.</p>
                        </div>
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
