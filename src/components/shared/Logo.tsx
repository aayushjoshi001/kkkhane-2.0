import Image from 'next/image'

interface LogoProps {
    /** Height class — e.g. "h-8", "h-10", "h-6". Width scales automatically. */
    className?: string
    /**
     * - `default`: full "kkkhane" wordmark (use on light surfaces)
     * - `dark`: round K icon only (legible on dark surfaces)
     */
    variant?: 'default' | 'dark'
}

/**
 * Brand logo. Renders the full wordmark on light surfaces and the
 * standalone K icon on dark surfaces. Height is driven by `className`.
 */
export default function Logo({ className = 'h-8', variant = 'default' }: LogoProps) {
    const isIcon = variant === 'dark'
    return (
        <Image
            src={isIcon ? '/brand/icon.png' : '/brand/full-logo.png'}
            alt="kkkhane"
            width={isIcon ? 96 : 394}
            height={96}
            priority
            className={`${className} w-auto object-contain select-none`}
            style={{ width: 'auto' }}
        />
    )
}
