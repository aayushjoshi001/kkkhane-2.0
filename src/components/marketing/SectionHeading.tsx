import { cn } from '@/lib/utils'
import Eyebrow from './Eyebrow'

export interface SectionHeadingProps {
    eyebrow?: string
    eyebrowTone?: 'brand' | 'purple'
    title: React.ReactNode
    subtitle?: React.ReactNode
    align?: 'center' | 'left'
    /** Render on a dark band (inverts text colors). */
    dark?: boolean
    className?: string
}

/** Centered (or left) eyebrow + extrabold title + muted subtitle. */
export default function SectionHeading({
    eyebrow,
    eyebrowTone = 'brand',
    title,
    subtitle,
    align = 'center',
    dark,
    className,
}: SectionHeadingProps) {
    return (
        <div
            className={cn(
                'mb-16 max-w-2xl',
                align === 'center' && 'mx-auto text-center',
                className,
            )}
        >
            {eyebrow && (
                <div className="mb-4">
                    <Eyebrow tone={eyebrowTone}>{eyebrow}</Eyebrow>
                </div>
            )}
            <h2
                className={cn(
                    'text-3xl font-extrabold tracking-tight sm:text-4xl',
                    dark ? 'text-white' : 'text-ink',
                )}
            >
                {title}
            </h2>
            {subtitle && (
                <p
                    className={cn(
                        'mt-4 text-lg font-medium leading-relaxed',
                        dark ? 'text-gray-300' : 'text-ink-subtle',
                    )}
                >
                    {subtitle}
                </p>
            )}
        </div>
    )
}
