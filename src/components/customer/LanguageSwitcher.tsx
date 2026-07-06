'use client'

import { useTranslation } from '@/lib/contexts/TranslationContext'

export default function LanguageSwitcher() {
    const { lang, setLang, supportedLanguages } = useTranslation()

    if (supportedLanguages.length <= 1) return null

    return (
        <div className="flex items-center gap-0.5 bg-surface-muted rounded-lg p-0.5">
            {supportedLanguages.map(l => (
                <button
                    key={l.code}
                    onClick={() => setLang(l.code)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                        lang === l.code
                            ? 'bg-surface shadow-sm text-ink'
                            : 'text-ink-subtle hover:text-ink-muted'
                    }`}
                >
                    {l.name}
                </button>
            ))}
        </div>
    )
}
