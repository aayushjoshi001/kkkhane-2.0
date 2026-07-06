import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'dark'
type Size = 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
    primary: 'bg-[var(--color-primary)] text-white shadow-xl shadow-[var(--color-primary)]/20 hover:scale-105',
    secondary: 'bg-surface text-ink border border-hairline-strong shadow-sm hover:bg-surface-muted hover:scale-105',
    dark: 'bg-[var(--color-secondary)] text-white shadow-lg hover:scale-105',
}

const SIZES: Record<Size, string> = {
    md: 'px-6 py-2.5 text-base',
    lg: 'px-8 py-4 text-lg',
}

export interface MarketingButtonProps {
    href: string
    variant?: Variant
    size?: Size
    /** Append a trailing arrow (the homepage CTA pattern). */
    arrow?: boolean
    className?: string
    children: React.ReactNode
}

/** Pill CTA — the homepage's primary action style. Always `rounded-full`. */
export default function MarketingButton({
    href,
    variant = 'primary',
    size = 'md',
    arrow,
    className,
    children,
}: MarketingButtonProps) {
    return (
        <Link
            href={href}
            className={cn(
                'inline-flex items-center justify-center gap-2 rounded-full font-bold transition-transform duration-200',
                VARIANTS[variant],
                SIZES[size],
                className,
            )}
        >
            {children}
            {arrow && <ArrowRight size={size === 'lg' ? 20 : 18} />}
        </Link>
    )
}
