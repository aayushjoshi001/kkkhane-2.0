import { cn } from '@/lib/utils'
import TableChip from './TableChip'

export interface OrderCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Short table label for the fixed chip (e.g. "T3"). Omit to hide chip. */
    tableLabel?: string
    title: React.ReactNode
    /** Meta row under the title (clock + time, item count, …). */
    meta?: React.ReactNode
    /** Right-aligned content: amount (tabular) or a <StatusBadge />. */
    trailing?: React.ReactNode
    /** Urgent items get a 3px danger indicator bar (not a full red card). */
    urgent?: boolean
    /** Renders a single primary tap target + cursor + hover lift. */
    onClick?: React.MouseEventHandler<HTMLDivElement>
    /** Play the gentle arrival pulse ring once. */
    pulse?: boolean
}

/**
 * Waiter-side order/session row. One radius, one padding, one shadow.
 * Left: fixed table chip · Middle: title + meta · Right: amount / status.
 */
export default function OrderCard({
    tableLabel,
    title,
    meta,
    trailing,
    urgent,
    onClick,
    pulse,
    className,
    ...props
}: OrderCardProps) {
    const tappable = typeof onClick === 'function'
    return (
        <div
            onClick={onClick}
            role={tappable ? 'button' : undefined}
            tabIndex={tappable ? 0 : undefined}
            onKeyDown={
                tappable
                    ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              ;(e.currentTarget as HTMLElement).click()
                          }
                      }
                    : undefined
            }
            className={cn(
                'relative flex items-center gap-4 overflow-hidden rounded-[20px] border border-hairline bg-surface p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)]',
                tappable &&
                    'cursor-pointer transition-[box-shadow,transform] duration-200 hover:shadow-[0_8px_30px_rgb(251,99,3,0.12)] hover:-translate-y-[2px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                pulse && 'pulse-once animate-scale-in',
                className,
            )}
            {...props}
        >
            {urgent && (
                <span className="absolute inset-y-0 left-0 w-[3px] bg-danger" aria-hidden />
            )}
            {tableLabel && <TableChip label={tableLabel} size="lg" className="rounded-2xl" />}
            <div className="min-w-0 flex-1">
                <div className="text-[17px] font-bold text-ink truncate tracking-tight">{title}</div>
                {meta && (
                    <div className="mt-1 flex items-center gap-2 text-[13px] font-medium text-ink-subtle flex-wrap">{meta}</div>
                )}
            </div>
            {trailing && <div className="shrink-0 text-right">{trailing}</div>}
        </div>
    )
}
