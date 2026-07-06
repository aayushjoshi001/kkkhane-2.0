'use client'
import Image from 'next/image'
import { HomepageConfig } from '@/types/database'
import Button from '@/components/ui/Button'
import Card from '@/components/ui/Card'

export default function ModernTemplate({ config, onMenuClick }: { config: HomepageConfig; onMenuClick: () => void }) {
    return (
        <div className="min-h-screen bg-canvas">
            <div className="relative h-[480px] md:h-[600px] overflow-hidden" style={{ backgroundColor: config.theme_primary }}>
                {config.hero_video_url && <video src={config.hero_video_url} autoPlay muted loop className="absolute inset-0 w-full h-full object-cover opacity-30" />}
                {config.hero_image_url && !config.hero_video_url && <Image src={config.hero_image_url} alt="Hero" fill className="object-cover opacity-30" sizes="100vw" />}
                <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" />
                <div className="relative h-full flex flex-col items-center justify-center text-center px-4 z-10 animate-fade-up">
                    <h1 className="text-display text-white mb-6 drop-shadow-lg">{config.hero_title}</h1>
                    <p className="text-h2 text-white/90 mb-10 max-w-2xl font-normal">{config.hero_subtitle}</p>
                    <button onClick={onMenuClick} className="inline-flex items-center gap-3 px-8 h-12 bg-surface/10 backdrop-blur-md border border-white/20 text-white rounded-pill text-sm font-semibold hover:bg-surface hover:text-ink transition-[background-color,color,transform] duration-300 hover:-translate-y-0.5 focus-ring shadow-lg">
                        {config.hero_cta_text} <span className="text-lg leading-none">→</span>
                    </button>
                </div>
            </div>

            {config.about?.enabled && (
                <div className="section-pad bg-surface">
                    <div className="container-pad">
                        <div className="grid md:grid-cols-2 gap-12 lg:gap-16 items-center">
                            {config.about.image_url && (
                                <div className="animate-fade-up relative h-80 md:h-[480px] w-full rounded-card overflow-hidden shadow-sm card-hover border border-hairline">
                                    <Image src={config.about.image_url} alt={config.about.title} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />
                                </div>
                            )}
                            <div className="animate-fade-up delay-100 flex flex-col gap-6">
                                <h2 className="text-display text-ink">{config.about.title}</h2>
                                <p className="text-body text-ink-muted">{config.about.description}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {config.features && config.features.length > 0 && (
                <div className="section-pad bg-canvas">
                    <div className="container-pad">
                        <h2 className="text-display text-center mb-16 text-ink animate-fade-up">Why Choose Us</h2>
                        <div className="grid md:grid-cols-3 gap-6 lg:gap-8">
                            {config.features.map((feature, idx) => (
                                <Card key={idx} className="text-center card-hover animate-fade-up flex flex-col items-center pt-10 pb-8 px-6" style={{ animationDelay: `${(idx+1)*100}ms` }}>
                                    <div className="size-16 rounded-[var(--r-md)] flex items-center justify-center mb-6 shadow-sm rotate-3 hover:rotate-0 transition-transform duration-300" style={{ backgroundColor: config.theme_primary }}>
                                        <span className="text-white text-2xl font-bold">✓</span>
                                    </div>
                                    <h3 className="text-h2 text-ink mb-3">{feature.title}</h3>
                                    <p className="text-body text-ink-subtle">{feature.description}</p>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {config.cta?.enabled && (
                <div className="section-pad" style={{ backgroundColor: config.theme_primary }}>
                    <div className="max-w-3xl mx-auto text-center text-white flex flex-col items-center gap-8 px-4">
                        <div className="flex flex-col gap-4">
                            <h2 className="text-display">{config.cta.headline}</h2>
                            <p className="text-h3 font-normal opacity-90">{config.cta.description}</p>
                        </div>
                        <button onClick={onMenuClick} className="inline-flex items-center justify-center h-12 px-8 bg-surface text-ink rounded-card font-semibold transition-transform duration-150 hover:-translate-y-0.5 focus-ring shadow-sm" style={{ color: config.theme_primary }}>
                            {config.cta.button_text}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
