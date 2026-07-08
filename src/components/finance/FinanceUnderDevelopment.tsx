import { 
    Sparkles, Wallet, Landmark, Receipt, Percent, 
    ArrowUpRight, PiggyBank, ShieldCheck, Activity, Clock 
} from 'lucide-react'

export default function FinanceUnderDevelopment() {
    const upcomingFeatures = [
        {
            title: 'Automated Ledger Posting',
            description: 'Double-entry bookkeeping automatically posting events from menu sales, supplier billing, and payroll to the ledger.',
            icon: Landmark,
            color: 'from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-400'
        },
        {
            title: 'Real-time Cash Flow sync',
            description: 'Instant reconciliation of physical cash drawers, digital NepalPay/QR, and bank deposit transactions.',
            icon: Wallet,
            color: 'from-emerald-500/20 to-teal-500/20 text-emerald-600 dark:text-emerald-400'
        },
        {
            title: 'VAT & Tax Compliance',
            description: 'Automated compilation of tax filings, PAN records, and IRD-compatible reporting templates.',
            icon: Percent,
            color: 'from-blue-500/20 to-indigo-500/20 text-blue-600 dark:text-blue-400'
        },
        {
            title: 'Budgeting & Variance Alerts',
            description: 'Establish seasonal departmental budgets with real-time alerts when expenditures exceed predefined thresholds.',
            icon: PiggyBank,
            color: 'from-purple-500/20 to-fuchsia-500/20 text-purple-600 dark:text-purple-400'
        }
    ]

    return (
        <div className="relative overflow-hidden bg-surface border border-hairline rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.02)] p-6 md:p-10 space-y-8 animate-fade-up">
            {/* Background Decorative Ambient Blur */}
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-brand-500/5 dark:bg-brand-500/10 rounded-full blur-[100px] pointer-events-none" />
            <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-amber-500/5 dark:bg-amber-500/10 rounded-full blur-[100px] pointer-events-none" />

            {/* Header Content */}
            <div className="max-w-2xl space-y-4 relative z-10">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 uppercase tracking-wider">
                    <Sparkles size={12} className="animate-pulse" />
                    Enterprise Feature — Under Development
                </div>
                
                <h2 className="text-2xl md:text-3xl font-black text-ink tracking-tight">
                    SaaS Restaurant Financial Engine
                </h2>
                
                <p className="text-ink-subtle text-sm md:text-base leading-relaxed">
                    We are constructing a robust, double-entry accounting and ledger reconciliation posting system. 
                    This module is exclusive to Enterprise clients and will release in the upcoming phase.
                </p>
            </div>

            {/* Upcoming Features Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 relative z-10">
                {upcomingFeatures.map((feature, i) => {
                    const Icon = feature.icon
                    return (
                        <div 
                            key={i} 
                            className="group flex gap-4 p-5 rounded-[20px] bg-surface-muted/30 border border-hairline/80 hover:border-brand-500/20 hover:bg-surface transition-all duration-300 hover:-translate-y-0.5"
                        >
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-gradient-to-br ${feature.color} shrink-0 group-hover:scale-105 transition-transform duration-300`}>
                                <Icon size={22} />
                            </div>
                            <div className="space-y-1.5">
                                <h3 className="font-bold text-ink text-[15px] group-hover:text-brand-600 transition-colors">
                                    {feature.title}
                                </h3>
                                <p className="text-ink-subtle text-xs leading-relaxed">
                                    {feature.description}
                                </p>
                            </div>
                        </div>
                    )
                })}
            </div>

            {/* Timeline / Progress Status */}
            <div className="bg-surface-muted/20 border border-hairline/60 rounded-2xl p-5 md:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                        <Clock size={20} className="animate-spin" style={{ animationDuration: '8s' }} />
                    </div>
                    <div>
                        <p className="font-bold text-ink text-sm">Ledger Database Schemas Active</p>
                        <p className="text-ink-subtle text-xs mt-0.5">Database tables, constraints, and audit logs are fully provisioned.</p>
                    </div>
                </div>
                
                <div className="flex items-center gap-2 text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 rounded-xl border border-blue-100 dark:border-blue-900/40 shrink-0">
                    <Activity size={12} />
                    Current Status: Core Schema Wired
                </div>
            </div>
        </div>
    )
}
