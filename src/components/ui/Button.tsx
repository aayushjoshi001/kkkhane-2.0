import { forwardRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

const ICON_SIZE: Record<Size, number> = { sm: 14, md: 16, lg: 18 }

const VARIANTS: Record<Variant, string> = {
    primary:
        'bg-gradient-to-b from-brand-500 to-brand-600 border-t border-brand-400 border-x border-brand-600 border-b border-brand-700 text-white shadow-[0_2px_10px_rgb(251,99,3,0.25)] hover:from-brand-400 hover:to-brand-500 active:from-brand-600 active:to-brand-700 focus-visible:ring-brand-500/40',
    secondary:
        'bg-gradient-to-b from-white to-surface-muted text-ink border border-hairline-strong shadow-sm hover:from-surface-muted hover:to-surface-muted focus-visible:ring-brand-500/40',
    ghost:
        'bg-transparent text-ink-muted hover:text-ink hover:bg-surface-muted focus-visible:ring-brand-500/30',
    danger:
        'bg-danger text-white hover:brightness-95 active:brightness-90 focus-visible:ring-danger/40',
    success:
        'bg-success text-white hover:brightness-95 active:brightness-90 focus-visible:ring-success/40',
}

const SIZES: Record<Size, string> = {
    sm: 'h-9 px-3 text-small gap-1.5 rounded-full',
    md: 'h-10 px-4 text-sm gap-2 rounded-full',
    lg: 'h-12 px-5 text-sm gap-2 rounded-full',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: Variant
    size?: Size
    /** Stretch to fill container width */
    block?: boolean
    /** Show a spinner and disable interaction */
    loading?: boolean
    /** Leading icon (hidden while loading). */
    icon?: LucideIcon
    /** Trailing icon, e.g. an arrow on a CTA. */
    iconRight?: LucideIcon
}

/**
 * The single button primitive. One radius, one shadow language, one focus ring.
 * Use `variant` for intent — never restyle ad-hoc.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size = 'md', block, loading, icon: Icon, iconRight: IconRight, disabled, className, children, ...props },
    ref,
) {
    const iconSize = ICON_SIZE[size]
    return (
        <button
            ref={ref}
            disabled={disabled || loading}
            className={cn(
                'inline-flex items-center justify-center font-semibold whitespace-nowrap select-none',
                'transition-[background-color,color,box-shadow,filter] duration-150',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                'disabled:opacity-50 disabled:pointer-events-none',
                VARIANTS[variant],
                SIZES[size],
                block && 'w-full',
                className,
            )}
            {...props}
        >
            {loading ? (
                <span className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden />
            ) : (
                Icon && <Icon size={iconSize} strokeWidth={2.25} aria-hidden />
            )}
            {children}
            {IconRight && <IconRight size={iconSize} strokeWidth={2.25} aria-hidden />}
        </button>
    )
})

export default Button
