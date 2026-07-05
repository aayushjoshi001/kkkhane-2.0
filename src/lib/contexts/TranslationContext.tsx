'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

export type TranslationRow = {
    language_code: string
    entity_type: string
    entity_id: string
    translated_text: string
}

export type SupportedLang = { code: string; name: string }

type TranslationContextValue = {
    lang: string
    setLang: (lang: string) => void
    t: (entityType: string, entityId: string, fallback: string) => string
    supportedLanguages: SupportedLang[]
}

const TranslationContext = createContext<TranslationContextValue>({
    lang: 'en',
    setLang: () => {},
    t: (_et, _id, fallback) => fallback,
    supportedLanguages: [],
})

export function TranslationProvider({
    children,
    translations,
    supportedLanguages,
    restaurantId,
}: {
    children: ReactNode
    translations: TranslationRow[]
    supportedLanguages: SupportedLang[]
    restaurantId: string
}) {
    const storageKey = `lang-${restaurantId}`
    const [lang, setLangState] = useState('en')

    useEffect(() => {
        const stored = localStorage.getItem(storageKey)
        if (stored && supportedLanguages.some(l => l.code === stored)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setLangState(stored)
        }
    }, [storageKey, supportedLanguages])

    const setLang = (code: string) => {
        setLangState(code)
        localStorage.setItem(storageKey, code)
    }

    const t = (entityType: string, entityId: string, fallback: string): string => {
        if (lang === 'en') return fallback
        const found = translations.find(
            tr => tr.language_code === lang && tr.entity_type === entityType && tr.entity_id === entityId
        )
        return found?.translated_text || fallback
    }

    return (
        <TranslationContext.Provider value={{ lang, setLang, t, supportedLanguages }}>
            {children}
        </TranslationContext.Provider>
    )
}

export function useTranslation() {
    return useContext(TranslationContext)
}
