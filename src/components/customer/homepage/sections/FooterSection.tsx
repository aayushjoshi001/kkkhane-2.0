'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'
import SocialLinks from './SocialLinks'

export default function FooterSection({
    footer,
    social,
    logoUrl,
    restaurantName,
}: {
    footer: HomepageConfig['footer']
    social: HomepageConfig['social']
    logoUrl?: string | null
    restaurantName?: string
}) {
    if (footer?.enabled === false) return null

    const copyright =
        footer?.copyright || `© ${new Date().getFullYear()} ${restaurantName || 'Your Restaurant'}`

    return (
        <footer className="bg-ink text-white py-10 px-4">
            <div className="max-w-6xl mx-auto flex flex-col items-center gap-5 text-center">
                {logoUrl ? (
                    <Image src={logoUrl} alt={restaurantName || 'Logo'} width={200} height={48} className="h-12 w-auto object-contain" />
                ) : (
                    restaurantName && <p className="text-lg font-semibold">{restaurantName}</p>
                )}
                <SocialLinks social={social} />
                <p className="text-ink-subtle text-sm">{copyright}</p>
            </div>
        </footer>
    )
}
