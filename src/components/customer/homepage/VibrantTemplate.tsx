'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'

export default function VibrantTemplate({ config, onMenuClick }: { config: HomepageConfig; onMenuClick: () => void }) {
    return <div className="min-h-screen" style={{ backgroundColor: config.theme_secondary }}>
        <div className="relative h-96 md:h-128 flex items-center justify-center overflow-hidden" style={{ backgroundColor: config.theme_accent }}>
            {config.hero_image_url && <Image src={config.hero_image_url} alt="Hero" fill className="object-cover opacity-40" sizes="100vw" />}
            <div className="relative z-10 text-center text-white">
                <h1 className="text-5xl md:text-6xl font-black mb-4">{config.hero_title}</h1>
                <p className="text-2xl mb-8">{config.hero_subtitle}</p>
                <button onClick={onMenuClick} className="px-8 py-3 bg-surface rounded-lg font-bold hover:scale-105" style={{ color: config.theme_accent }}>{config.hero_cta_text}</button>
            </div>
        </div>

        {config.about?.enabled && <div className="py-20 px-4 bg-surface">
            <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-4xl font-bold mb-8" style={{ color: config.theme_accent }}>{config.about.title}</h2>
                <p className="text-lg text-ink-muted">{config.about.description}</p>
            </div>
        </div>}

        {config.features && config.features.length > 0 && <div className="py-20 px-4" style={{ backgroundColor: config.theme_primary }}>
            <div className="max-w-6xl mx-auto">
                <h2 className="text-4xl font-black text-white text-center mb-16">What We Offer</h2>
                <div className="grid md:grid-cols-3 gap-8">
                    {config.features.map((feature, idx) => <div key={idx} className="bg-surface/10 p-8 rounded-lg text-white">
                        <h3 className="text-2xl font-bold mb-3">{feature.title}</h3>
                        <p>{feature.description}</p>
                    </div>)}
                </div>
            </div>
        </div>}

        {config.cta?.enabled && <div className="py-20 px-4 bg-surface">
            <div className="max-w-4xl mx-auto text-center">
                <h2 className="text-4xl font-bold mb-6" style={{ color: config.theme_accent }}>{config.cta.headline}</h2>
                <p className="text-lg text-ink-muted mb-8">{config.cta.description}</p>
                <button onClick={onMenuClick} className="px-8 py-3 rounded-lg text-white font-bold hover:scale-105" style={{ backgroundColor: config.theme_accent }}>{config.cta.button_text}</button>
            </div>
        </div>}
    </div>
}
