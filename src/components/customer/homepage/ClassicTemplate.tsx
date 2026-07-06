'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'
import Card from '@/components/ui/Card'

export default function ClassicTemplate({ config, onMenuClick }: { config: HomepageConfig; onMenuClick: () => void }) {
    return (
        <div className="min-h-screen bg-canvas">
            <div className="relative h-[480px] md:h-[600px] flex items-center justify-center px-4 overflow-hidden" style={{ backgroundColor: config.theme_primary }}>
                {config.hero_image_url && <Image src={config.hero_image_url} alt="Hero" fill className="object-cover opacity-40 mix-blend-overlay animate-scale-in" sizes="100vw" />}
                <div className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" />
                <div className="relative text-center text-white z-10 animate-fade-up max-w-3xl flex flex-col items-center">
                    <h1 className="text-5xl md:text-[80px] leading-[1.1] font-serif mb-6 drop-shadow-md">{config.hero_title}</h1>
                    <p className="text-xl md:text-2xl mb-10 text-white/90 font-light">{config.hero_subtitle}</p>
                    <button onClick={onMenuClick} className="h-12 px-10 border border-white/30 bg-surface/10 backdrop-blur-md rounded-card hover:bg-surface hover:text-ink transition-colors duration-300 font-semibold text-sm focus-ring shadow-lg">
                        {config.hero_cta_text}
                    </button>
                </div>
            </div>

            {config.about?.enabled && (
                <div className="section-pad bg-surface border-b border-hairline">
                    <div className="max-w-4xl mx-auto container-pad animate-fade-up delay-100 flex flex-col gap-6 text-center">
                        <h2 className="text-5xl font-serif text-ink">{config.about.title}</h2>
                        <p className="text-body-strong text-ink-muted max-w-2xl mx-auto">{config.about.description}</p>
                    </div>
                </div>
            )}

            {config.features && config.features.length > 0 && (
                <div className="section-pad bg-surface-muted">
                    <div className="max-w-6xl mx-auto container-pad">
                        <h2 className="text-5xl font-serif text-center mb-16 animate-fade-up text-ink">{config.features.length > 0 ? "Our Specialties" : ""}</h2>
                        <div className="grid md:grid-cols-3 gap-8">
                            {config.features.map((f, i) => (
                                <Card key={i} className="border-l-[3px] rounded-l-none border-y-hairline border-r-hairline rounded-r-card p-8 animate-fade-up card-hover" style={{ borderLeftColor: config.theme_primary, animationDelay: `${(i+1)*150}ms` }}>
                                    <h3 className="text-h2 font-serif text-ink mb-3">{f.title}</h3>
                                    <p className="text-body text-ink-subtle">{f.description}</p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {config.cta?.enabled && (
                <div className="section-pad bg-surface border-t border-hairline">
                    <div className="max-w-3xl mx-auto text-center flex flex-col items-center gap-8 px-4 animate-fade-up">
                        <div className="flex flex-col gap-4">
                            <h2 className="text-5xl font-serif text-ink">{config.cta.headline}</h2>
                            <p className="text-h3 font-normal text-ink-muted">{config.cta.description}</p>
                        </div>
                        <button onClick={onMenuClick} className="h-12 px-10 text-white rounded-card hover:-translate-y-0.5 transition-[transform,box-shadow] duration-150 font-semibold text-sm focus-ring shadow-sm hover:shadow-md" style={{ backgroundColor: config.theme_primary }}>
                            {config.cta.button_text}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
