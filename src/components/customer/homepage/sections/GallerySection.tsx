'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'

export default function GallerySection({
    gallery,
    accent,
}: {
    gallery: HomepageConfig['gallery']
    accent?: string
}) {
    const items = (gallery || []).filter((g) => g.image_url)
    if (items.length === 0) return null

    return (
        <section className="py-16 md:py-24 px-4 bg-surface">
            <div className="max-w-6xl mx-auto">
                <div className="text-center mb-12">
                    <h2 className="text-3xl font-bold text-ink">Gallery</h2>
                    <div className="w-16 h-1 mx-auto mt-3 rounded-full" style={{ backgroundColor: accent || '#EC4899' }} />
                </div>
                <div className="relative overflow-hidden w-full group py-4 flex flex-col justify-center">
                    <div className="flex w-max animate-marquee hover:[animation-play-state:paused]">
                        {[...items, ...items, ...items, ...items].map((item, idx) => {
                            const isVideo = item.media_type === 'video' || item.image_url.match(/\.(mp4|webm|mov)(\?.*)?$/i)
                            return (
                            <figure
                                key={idx}
                                className="relative overflow-hidden rounded-2xl w-64 md:w-80 h-64 md:h-80 shrink-0 bg-surface-muted shadow-md card-hover mr-4 md:mr-6"
                            >
                                {isVideo ? (
                                    <video
                                        src={item.image_url}
                                        className="w-full h-full object-cover transition duration-700 hover:scale-110"
                                        autoPlay muted loop playsInline
                                    />
                                ) : (
                                    <Image
                                        src={item.image_url}
                                        alt={item.caption || `Gallery image ${idx + 1}`}
                                        fill
                                        sizes="(max-width: 768px) 16rem, 20rem"
                                        className="object-cover transition duration-700 hover:scale-110"
                                    />
                                )}
                                {item.caption && (
                                    <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white p-4 pt-12 opacity-0 hover:opacity-100 transition-opacity duration-300">
                                        <p className="font-medium text-sm translate-y-2 hover:translate-y-0 transition-transform duration-300">{item.caption}</p>
                                    </figcaption>
                                )}
                            </figure>
                        )})}
                    </div>
                </div>
            </div>
        </section>
    )
}
