import Image from 'next/image'

/**
 * Decorative hero band used behind the /login and /signup cards — a brand-orange
 * gradient banner with the logo badge, tagline, and dot-grid/blur ornamentation.
 * The card that overlaps it is left to each page (widths differ: signup's
 * multi-step wizard is wider than the login form).
 */
export default function AuthHero({ heightClassName = 'h-64 sm:h-72' }: { heightClassName?: string }) {
    return (
        <div className={`relative w-full ${heightClassName} shrink-0 overflow-hidden bg-gradient-to-br from-brand-400 via-[var(--color-primary)] to-brand-700`}>
            {/* Ambient blurred circles */}
            <div className="absolute -top-12 -right-10 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-16 -left-12 w-52 h-52 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] h-[420px] rounded-full border border-white/10" />

            {/* Dot-grid corner ornaments */}
            <DotGrid className="absolute top-5 left-5 sm:top-7 sm:left-7" />
            <DotGrid className="absolute bottom-5 right-5 sm:bottom-7 sm:right-7" />

            <div className="relative z-10 h-full flex flex-col items-center justify-center gap-3 px-4 text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white shadow-lg flex items-center justify-center p-1.5">
                    <Image src="/brand/icon.png" alt="" width={64} height={64} className="w-full h-full object-contain" />
                </div>
                <span className="text-white font-extrabold text-2xl sm:text-3xl tracking-tight">kkkhane</span>
                <span className="text-white/80 text-[10px] sm:text-[11px] font-bold tracking-[0.15em] uppercase">
                    Your Trusted Restaurant Management Application
                </span>
            </div>
        </div>
    )
}

function DotGrid({ className = '' }: { className?: string }) {
    return (
        <div className={`grid grid-cols-4 gap-1.5 opacity-40 ${className}`}>
            {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} className="w-1 h-1 rounded-full bg-white" />
            ))}
        </div>
    )
}
