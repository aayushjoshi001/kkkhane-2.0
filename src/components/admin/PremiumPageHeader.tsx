import React from 'react'

interface PremiumPageHeaderProps {
    title: string
    description: string
    icon?: React.ReactNode
    actions?: React.ReactNode
    color?: 'orange' | 'blue' | 'purple' | 'green'
}

export default function PremiumPageHeader({ title, description, icon, actions, color = 'orange' }: PremiumPageHeaderProps) {
    const bgColors = {
        orange: 'bg-[#ff5a00]',
        blue: 'bg-blue-500',
        purple: 'bg-purple-500',
        green: 'bg-green-500'
    }

    return (
        <div className="relative overflow-hidden rounded-[2rem] bg-[#0a0a0a] text-white p-8 sm:p-12 shadow-2xl mb-8 animate-fade-up">
            {/* Glowing background orbs */}
            <div className={`absolute top-0 right-0 w-[500px] h-[500px] ${bgColors[color]} opacity-20 blur-[120px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none`} />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-blue-500 opacity-20 blur-[100px] rounded-full -translate-x-1/3 translate-y-1/4 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                    {icon && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface/10 backdrop-blur-md border border-white/10 mb-6 text-sm font-medium text-white/90">
                            {icon}
                        </div>
                    )}
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 leading-tight">
                        {title}
                    </h1>
                    <p className="text-white/60 text-[16px] max-w-xl leading-relaxed">
                        {description}
                    </p>
                </div>
                {actions && (
                    <div className="shrink-0 flex flex-wrap gap-3">
                        {actions}
                    </div>
                )}
            </div>
        </div>
    )
}
