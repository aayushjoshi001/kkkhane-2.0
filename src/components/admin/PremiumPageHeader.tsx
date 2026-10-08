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
        orange: 'bg-brand-500',
        blue: 'bg-blue-500',
        purple: 'bg-purple-500',
        green: 'bg-green-500'
    }

    return (
        <div className="relative overflow-hidden rounded-[2rem] bg-brand-500 text-white p-8 sm:p-10 shadow-2xl mb-8 animate-fade-up min-h-[200px] flex flex-col justify-center">
            {/* Herringbone texture */}
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='20'%3E%3Cpath d='M0 20 L10 10 L20 20' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M20 20 L30 10 L40 20' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M0 0 L10 10 L20 0' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3Cpath d='M20 0 L30 10 L40 0' fill='none' stroke='rgba(255,255,255,0.16)' stroke-width='1.5'/%3E%3C/svg%3E")`, backgroundSize: '40px 20px' }} />
            {/* Depth glow blobs */}
            <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white opacity-5 blur-[120px] rounded-full translate-x-1/3 -translate-y-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-black opacity-10 blur-[100px] rounded-full -translate-x-1/3 translate-y-1/4 pointer-events-none" />

            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                    {icon && (
                        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/20 mb-6 text-sm font-medium text-white">
                            {icon}
                        </div>
                    )}
                    <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4 leading-tight">
                        {title}
                    </h1>
                    <p className="text-white/75 text-[16px] max-w-xl leading-relaxed">
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
