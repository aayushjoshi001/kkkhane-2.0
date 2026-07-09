import { ShieldCheck, Zap, TrendingUp, HeartHandshake, Lightbulb, Users, ArrowRight } from 'lucide-react'
import { MarketingNav, MarketingFooter, Eyebrow } from '@/components/marketing'

const VALUES = [
    {
        icon: ShieldCheck,
        title: 'Safe and Secure',
        description: 'We value your trust, safeguarding your restaurant’s data with utmost care and enterprise-grade encryption.',
        color: 'text-purple-500',
        bg: 'bg-purple-100'
    },
    {
        icon: TrendingUp,
        title: 'Stable & Scalable',
        description: 'Built to effortlessly adapt as your restaurant grows from a single cafe to a multi-outlet franchise.',
        color: 'text-blue-500',
        bg: 'bg-blue-100'
    },
    {
        icon: Zap,
        title: 'Fast Performance',
        description: 'Swift solutions designed to keep pace with the dynamic and fast-paced restaurant environment.',
        color: 'text-amber-500',
        bg: 'bg-amber-100'
    },
    {
        icon: Lightbulb,
        title: 'Useful & Creative Features',
        description: 'Practical, user-friendly features crafted from deep industry insights and customer feedback.',
        color: 'text-rose-500',
        bg: 'bg-rose-100'
    },
    {
        icon: Users,
        title: 'Continuous Growth',
        description: 'Always learning, always improving to serve you better and stay ahead of industry trends.',
        color: 'text-green-500',
        bg: 'bg-green-100'
    },
    {
        icon: HeartHandshake,
        title: 'Expert Support',
        description: 'Compassionate, reliable support, ready to assist whenever you need to ensure your operations never stop.',
        color: 'text-[var(--color-primary)]',
        bg: 'bg-[var(--color-primary)]/10'
    }
]

export default function CareerPage() {
    return (
        <div className="min-h-screen bg-surface text-ink font-sans">
            <MarketingNav />

            {/* Hero Section */}
            <section className="pt-32 pb-20 px-4 relative overflow-hidden bg-[#FAFAF8] border-b border-hairline text-center">
                <div className="absolute top-0 right-0 -mr-32 -mt-32 w-96 h-96 bg-purple-50 rounded-full blur-3xl opacity-50"></div>
                <div className="max-w-[800px] mx-auto relative z-10">
                    <div className="mb-6 inline-flex justify-center"><Eyebrow tone="brand">Join Our Team</Eyebrow></div>
                    <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-ink mb-6">
                        Help us build the future of <span className="text-[var(--color-primary)]">Dining</span> in Nepal
                    </h1>
                    <p className="text-lg md:text-xl text-ink-subtle font-medium max-w-2xl mx-auto leading-relaxed">
                        We are a fast-growing team of engineers, designers, and former restaurateurs on a mission to empower every food business with smart technology.
                    </p>
                </div>
            </section>

            {/* Values Section */}
            <section className="py-24 px-4 max-w-[1200px] mx-auto">
                <div className="text-center mb-16">
                    <h2 className="text-3xl font-extrabold text-ink mb-4">Our Core Values</h2>
                    <p className="text-ink-subtle font-medium">The principles that guide everything we build and how we work.</p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {VALUES.map((val) => (
                        <div key={val.title} className="bg-surface rounded-3xl p-8 border border-hairline shadow-sm hover:shadow-md transition-shadow">
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${val.bg}`}>
                                <val.icon className={val.color} size={28} />
                            </div>
                            <h3 className="text-xl font-bold text-ink mb-3">{val.title}</h3>
                            <p className="text-ink-subtle font-medium leading-relaxed">{val.description}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Open Positions Section */}
            <section className="py-20 px-4 bg-[#FAFAF8] border-t border-hairline">
                <div className="max-w-[800px] mx-auto text-center">
                    <div className="mb-12">
                        <h2 className="text-3xl font-extrabold text-ink mb-4">Current Openings!</h2>
                        <p className="text-ink-subtle font-medium">We are always looking for exceptional talent in Engineering, Sales, and Customer Success.</p>
                    </div>

                    <div className="bg-surface rounded-[2rem] p-10 md:p-16 border border-hairline shadow-xl relative overflow-hidden">
                        <div className="absolute -left-20 -bottom-20 w-64 h-64 bg-brand-50 rounded-full blur-3xl opacity-50"></div>
                        <div className="relative z-10 flex flex-col items-center">
                            <div className="w-20 h-20 bg-surface-muted rounded-full flex items-center justify-center mb-6 border border-hairline text-3xl">
                                📩
                            </div>
                            <h3 className="text-2xl font-bold text-ink mb-4">Don&apos;t see your role?</h3>
                            <p className="text-ink-muted font-medium mb-8 max-w-md">
                                We currently don&apos;t have any specific open roles listed online, but if you believe you would be a fantastic fit for our team, we want to hear from you.
                            </p>
                            <a 
                                href="mailto:info.kkkhane@gmail.com" 
                                className="inline-flex items-center gap-2 text-[var(--color-primary)] font-bold hover:gap-3 transition-all"
                            >
                                info.kkkhane@gmail.com <ArrowRight size={16} />
                            </a>
                            <p className="mt-4 text-sm text-ink-subtle font-medium">Please include your CV and a brief introduction.</p>
                        </div>
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
