import NepaliDate from 'nepali-date-converter'

// Set default language to Nepali (or English based on preference)
// NepaliDate.language = 'np' 

/**
 * Converts a standard JavaScript Date (AD) to a Nepali Date (BS) string.
 * @param date The JS Date object (or ISO string)
 * @param format Format string (e.g. 'YYYY-MM-DD', 'YYYY MMMM DD')
 * @param lang 'np' for Nepali characters (२०८०), 'en' for English characters (2080)
 */
export function toNepaliDate(date: Date | string, format: string = 'YYYY-MM-DD', lang: 'np' | 'en' = 'en'): string {
    const d = new Date(date)
    const nd = new NepaliDate(d)
    
    // Store original lang
    const originalLang = NepaliDate.language
    
    // Set to requested lang
    NepaliDate.language = lang
    
    const formatted = nd.format(format)
    
    // Restore original lang to avoid side effects
    NepaliDate.language = originalLang
    
    return formatted
}

/**
 * Gets the current Nepali date
 */
export function currentNepaliDate(format: string = 'YYYY-MM-DD', lang: 'np' | 'en' = 'en'): string {
    return toNepaliDate(new Date(), format, lang)
}
