import { cn } from '@/lib/utils'

type Tone = 'white' | 'band' | 'gray' | 'dark'

const TONES: Record<Tone, string> = {
    white: 'bg-surface',
    band: 'bg-[#f6eee2]',
    gray: 'bg-surface-muted',
    dark: 'bg-[var(--color-secondary)] text-white',
}

export interface SectionProps {
    tone?: Tone
    /** Vertical padding rhythm. Default matches the homepage's py-24. */
    size?: 'md' | 'lg'
    id?: string
    className?: string
    containerClassName?: string
    /** Drop the max-width container (for full-bleed sections). */
    bare?: boolean
    children: React.ReactNode
}

/** Marketing section band: tone background + centered max-w container. */
export default function Section({
    tone = 'white',
    size = 'lg',
    id,
    className,
    containerClassName,
    bare,
    children,
}: SectionProps) {
    return (
        <section
            id={id}
            className={cn(size === 'lg' ? 'py-20 sm:py-24' : 'py-14 sm:py-16', TONES[tone], className)}
        >
            {bare ? (
                children
            ) : (
                <div className={cn('mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-8', containerClassName)}>
                    {children}
                </div>
            )}
        </section>
    )
}
