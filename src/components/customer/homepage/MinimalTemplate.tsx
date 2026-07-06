'use client'
import { HomepageConfig } from '@/types/database'
export default function MinimalTemplate({ config, onMenuClick }: { config: HomepageConfig; onMenuClick: () => void }) {
    return <div className="min-h-screen bg-surface text-ink">
        <div className="h-96 md:h-128 flex flex-col justify-center items-center px-4" style={{ backgroundColor: config.theme_primary }}>
            <h1 className="text-6xl font-light tracking-tight mb-6 text-white">{config.hero_title}</h1>
            <p className="text-xl text-white/80 mb-8">{config.hero_subtitle}</p>
            <button onClick={onMenuClick} className="px-6 py-2 border border-white text-white hover:bg-surface/10">{config.hero_cta_text}</button>
        </div>
        {config.about?.enabled && <div className="py-20 px-4 max-w-4xl mx-auto"><h2 className="text-4xl font-light mb-8">{config.about.title}</h2><p className="text-ink-muted text-lg">{config.about.description}</p></div>}
        {config.features && config.features.length > 0 && <div className="py-20 px-4 border-t"><div className="max-w-6xl mx-auto"><div className="grid md:grid-cols-2 gap-16">{config.features.map((f, i) => <div key={i}><h3 className="text-2xl font-light mb-2">{f.title}</h3><p className="text-ink-muted">{f.description}</p></div>)}</div></div></div>}
        {config.cta?.enabled && <div className="py-20 px-4 max-w-4xl mx-auto text-center"><h2 className="text-4xl font-light mb-6">{config.cta.headline}</h2><p className="text-ink-muted mb-8">{config.cta.description}</p><button onClick={onMenuClick} className="px-8 py-2 border" style={{ borderColor: config.theme_primary, color: config.theme_primary }}>{config.cta.button_text}</button></div>}
    </div>
}
