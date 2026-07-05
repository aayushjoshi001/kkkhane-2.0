'use client'
import { HomepageConfig } from '@/types/database'
import { MapPin, Phone, Mail, Star } from 'lucide-react'
import dynamic from 'next/dynamic'

const OpenStreetMap = dynamic(() => import('./OpenStreetMap'), {
    ssr: false,
    loading: () => <div className="min-h-[260px] bg-gray-200 animate-pulse rounded-2xl w-full h-full" />
})



export default function ContactSection({
    contact,
    primary,
}: {
    contact: HomepageConfig['contact']
    primary?: string
}) {
    const c = contact || {}
    const hasContactInfo = c.phone || c.email || c.map_address || c.review_link || c.map_embed_url

    if (c.enabled === false || !hasContactInfo) return null

    return (
        <section className="py-16 md:py-24 px-4 bg-gray-50">
            <div className="max-w-6xl mx-auto">
                <h2 className="text-3xl font-bold text-center mb-12 text-gray-900">Visit Us</h2>
                <div className="grid md:grid-cols-2 gap-8 items-stretch">
                    {/* Map */}
                    {(c.map_address || c.map_embed_url) && (
                        <div className="rounded-2xl overflow-hidden shadow-sm min-h-[260px] bg-gray-200 relative z-10 flex">
                            <OpenStreetMap address={c.map_address} embedUrl={c.map_embed_url} />
                        </div>
                    )}

                    {/* Details */}
                    <div className="flex flex-col justify-center gap-5">
                        {c.map_address && (
                            <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.map_address)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-start gap-3 text-gray-700 hover:text-gray-900"
                            >
                                <MapPin size={22} style={{ color: primary }} className="shrink-0 mt-0.5" />
                                <span>{c.map_address}</span>
                            </a>
                        )}
                        {c.phone && (
                            <a href={`tel:${c.phone}`} className="flex items-center gap-3 text-gray-700 hover:text-gray-900">
                                <Phone size={22} style={{ color: primary }} className="shrink-0" />
                                <span>{c.phone}</span>
                            </a>
                        )}
                        {c.email && (
                            <a href={`mailto:${c.email}`} className="flex items-center gap-3 text-gray-700 hover:text-gray-900">
                                <Mail size={22} style={{ color: primary }} className="shrink-0" />
                                <span>{c.email}</span>
                            </a>
                        )}

                        {c.review_link && (
                            <a
                                href={c.review_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-white font-semibold w-fit hover:opacity-90 transition"
                                style={{ backgroundColor: primary || '#FB6303' }}
                            >
                                <Star size={18} fill="currentColor" />
                                Leave a Review
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </section>
    )
}
