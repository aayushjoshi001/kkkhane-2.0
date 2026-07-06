'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'

export default function ElegantTemplate({ config, onMenuClick }: { config: HomepageConfig; onMenuClick: () => void }) {
    return (
        <div className="min-h-screen bg-surface">
            <div className="relative h-96 md:h-128 flex items-center justify-center" style={{ backgroundColor: config.theme_primary }}>
                {config.hero_image_url && <Image src={config.hero_image_url} alt="Hero" fill className="object-cover opacity-20" sizes="100vw" />}
                <div className="relative z-10 text-center text-white">
                    <h1 className="text-5xl md:text-6xl font-serif mb-4">{config.hero_title}</h1>
                    <p className="text-xl md:text-2xl mb-12 opacity-90">{config.hero_subtitle}</p>
                    <button onClick={onMenuClick} className="px-8 py-3 border-2 border-white rounded-lg hover:bg-surface/10">{config.hero_cta_text}</button>
                </div>
            </div>

            {config.about?.enabled && (
                <>
                    <div className="h-px" style={{ backgroundColor: config.theme_primary }} />
                    <div className="py-20 px-4 bg-surface">
                        <div className="max-w-4xl mx-auto text-center">
                            <h2 className="text-4xl font-serif mb-8" style={{ color: config.theme_primary }}>{config.about.title}</h2>
                            <p className="text-lg text-ink-muted">{config.about.description}</p>
                        </div>
                    </div>
                </>
            )}

            {config.features && config.features.length > 0 && (
                <>
                    <div className="h-px" style={{ backgroundColor: config.theme_primary }} />
                    <div className="py-20 px-4 bg-surface-muted">
                        <div className="max-w-6xl mx-auto">
                            <h2 className="text-4xl font-serif text-center mb-16" style={{ color: config.theme_primary }}>Our Features</h2>
                            <div className="grid md:grid-cols-2 gap-12">
                                {config.features.map((feature, idx) => (
                                    <div key={idx} className="border-l-4 pl-6" style={{ borderColor: config.theme_primary }}>
                                        <h3 className="text-2xl font-serif mb-3" style={{ color: config.theme_primary }}>{feature.title}</h3>
                                        <p className="text-ink-muted">{feature.description}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </>
            )}

            {config.cta?.enabled && (
                <>
                    <div className="h-px" style={{ backgroundColor: config.theme_primary }} />
                    <div className="py-20 px-4 bg-surface">
                        <div className="max-w-4xl mx-auto text-center">
                            <h2 className="text-4xl font-serif mb-6" style={{ color: config.theme_primary }}>{config.cta.headline}</h2>
                            <p className="text-lg text-ink-muted mb-8">{config.cta.description}</p>
                            <button onClick={onMenuClick} className="px-8 py-3 rounded-lg text-white hover:scale-105" style={{ backgroundColor: config.theme_primary }}>{config.cta.button_text}</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
