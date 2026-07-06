import { cn } from '@/lib/utils'

export interface FeatureCardProps {
    title: React.ReactNode
    desc?: React.ReactNode
    /** Decorative illustration node, shown in a gradient tile above the text. */
    illustration?: React.ReactNode
    /** Tailwind gradient classes for the illustration tile (homepage pastel system). */
    gradient?: string
    /** Inline icon (used when there is no illustration tile). */
    icon?: React.ReactNode
    align?: 'center' | 'left'
    className?: string
}

/**
 * The homepage feature card: white, rounded-3xl, soft shadow that lifts on hover.
 * Optionally tops with a pastel-gradient illustration tile.
 */
export default function FeatureCard({
    title,
    desc,
    illustration,
    gradient = 'from-gray-50 to-gray-100',
    icon,
    align = 'center',
    className,
}: FeatureCardProps) {
    return (
        <div
            className={cn(
                'group rounded-3xl border border-hairline bg-surface p-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl',
                align === 'center' ? 'text-center' : 'text-left',
                className,
            )}
        >
            {illustration && (
                <div
                    className={cn(
                        'relative mb-6 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br',
                        gradient,
                    )}
                >
                    <div className="transition-transform duration-500 group-hover:scale-105">{illustration}</div>
                </div>
            )}
            {icon && !illustration && <div className="mb-4">{icon}</div>}
            <h3 className="mb-3 text-xl font-bold text-ink">{title}</h3>
            {desc && <p className="text-sm font-medium leading-relaxed text-ink-subtle">{desc}</p>}
        </div>
    )
}
