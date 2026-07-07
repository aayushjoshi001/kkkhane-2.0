'use client'

import { cn } from '@/lib/utils'

export interface SectionTab {
    key: string
    label: string
    count?: number
}

export interface SectionTabsProps {
    tabs: SectionTab[]
    active: string
    onChange: (key: string) => void
    className?: string
}

/** Tab bar used inside a finance section page (e.g. Cash: Drawers | Transactions | Counting). */
export default function SectionTabs({ tabs, active, onChange, className }: SectionTabsProps) {
    return (
        <div className={cn('flex items-center gap-1 overflow-x-auto border-b border-hairline scrollbar-none', className)}>
            {tabs.map((tab) => {
                const isActive = tab.key === active
                return (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => onChange(tab.key)}
                        className={cn(
                            'relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold whitespace-nowrap transition-colors shrink-0',
                            isActive ? 'text-brand-600' : 'text-ink-subtle hover:text-ink',
                        )}
                    >
                        {tab.label}
                        {typeof tab.count === 'number' && (
                            <span
                                className={cn(
                                    'text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[18px] text-center',
                                    isActive ? 'bg-brand-500 text-white' : 'bg-surface-muted text-ink-muted',
                                )}
                            >
                                {tab.count}
                            </span>
                        )}
                        {isActive && <span className="absolute bottom-0 left-0 w-full h-[2px] bg-brand-500 rounded-t-full" />}
                    </button>
                )
            })}
        </div>
    )
}
