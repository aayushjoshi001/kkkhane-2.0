'use client'

import { useState, useEffect } from 'react'
import { Megaphone, X, ExternalLink, ArrowRight } from 'lucide-react'

import { getSystemAdvertisementsAction } from '@/app/(admin)/admin/super-admin/actions'

interface Ad {
    id: string | number
    title: string
    description: string
    cta: string
    badge: string
    link: string
}

const ADS: Ad[] = [
    {
        id: '1',
        badge: 'NEW INTEGRATION',
        title: 'Supercharge Room Bookings with Booking.com Sync',
        description: 'Connect your hotel rooms directory directly to online travel agents for automatic real-time rate updates and zero overbookings.',
        cta: 'Connect Channels',
        link: '/admin/settings'
    },
    {
        id: '2',
        badge: 'HARDWARE CORNER',
        title: 'Auto-Print KOTs to Your Thermal Printer',
        description: 'Point your 80mm LAN printer at the cashier counter and KOT tickets print the moment an order is confirmed. No manual reprints.',
        cta: 'Set Up Printer',
        link: '/admin/printers'
    },
    {
        id: '3',
        badge: 'SRMS PLATINUM',
        title: 'Auto-Backup Data to Google Drive & Dropbox',
        description: 'Never worry about server outages or laptop loss. Keep encrypted hourly database backups synced automatically to your own cloud storage.',
        cta: 'Enable Backups',
        link: '/admin/profile'
    }
]

export default function AdSpace() {
    const [ads, setAds] = useState<Ad[]>(ADS)
    const [currentIndex, setCurrentIndex] = useState(0)

    useEffect(() => {
        getSystemAdvertisementsAction().then(res => {
            if (res?.data && res.data.length > 0) {
                setAds(res.data)
            }
        }).catch(err => {
            console.error('Failed to load system advertisements from db:', err)
        })
    }, [])

    useEffect(() => {
        if (ads.length <= 1) return
        const timer = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % ads.length)
        }, 12000) // Rotate ads every 12 seconds
        return () => clearInterval(timer)
    }, [ads.length])

    const ad = ads[currentIndex] || ADS[0]

    return (
        <div className="w-full bg-surface border border-hairline rounded-2xl shadow-sm overflow-hidden animate-fade-in relative print:hidden">
            {/* Ambient Background Glow */}
            <div className="absolute inset-0 bg-gradient-to-r from-brand-500/5 via-transparent to-brand-500/5 pointer-events-none" />

            <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
                <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 border border-brand-100">
                        <Megaphone size={16} className="text-brand-500 animate-bounce" />
                    </div>
                    <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black uppercase text-brand-600 tracking-wider bg-brand-50 px-2 py-0.5 rounded-md border border-brand-100">
                                {ad.badge}
                            </span>
                            <span className="text-[9px] font-black uppercase text-ink-subtle tracking-wider">
                                Sponsor
                            </span>
                        </div>
                        <h4 className="text-sm font-black text-ink">{ad.title}</h4>
                        <p className="text-xs text-ink-subtle max-w-2xl">{ad.description}</p>
                    </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                    <a
                        href={ad.link}
                        target={ad.link.startsWith('http') ? '_blank' : '_self'}
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white font-extrabold rounded-xl text-xs transition-all shadow-sm shadow-brand-500/10 active:scale-95 group"
                    >
                        {ad.cta}
                        <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
                    </a>
                </div>
            </div>
        </div>
    )
}
