import { BarChart3, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PlaceholderChartProps {
    icon?: LucideIcon
    title: string
    description?: string
    height?: number
    className?: string
}

/** Empty-state chart block for Dashboard/Statements/Reports pages awaiting the Phase 2 posting engine. */
export default function PlaceholderChart({ icon: Icon = BarChart3, title, description, height = 240, className }: PlaceholderChartProps) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-hairline-strong bg-surface-muted/30 text-center px-6',
                className,
            )}
            style={{ height }}
        >
            <span className="grid place-items-center size-10 rounded-full bg-surface text-ink-subtle shadow-sm">
                <Icon size={20} strokeWidth={2} />
            </span>
            <p className="text-sm font-bold text-ink-muted">{title}</p>
            {description && <p className="text-xs text-ink-subtle max-w-xs">{description}</p>}
        </div>
    )
}
