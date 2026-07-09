import { Inter, Playfair_Display, Roboto, Lato, Outfit, Noto_Sans_Devanagari } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { ConfirmModal } from '@/components/shared/ConfirmModal'
import type { Viewport, Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/server'
import { unstable_cache } from 'next/cache'
import { SerwistProvider } from '@serwist/turbopack/react'
import PwaInstallPrompt from '@/components/shared/PwaInstallPrompt'
import PwaUpdatePrompt from '@/components/shared/PwaUpdatePrompt'
import Script from 'next/script'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const playfair = Playfair_Display({ subsets: ['latin'], variable: '--font-playfair', display: 'swap' })
const roboto = Roboto({ weight: ['400', '500', '700'], subsets: ['latin'], variable: '--font-roboto', display: 'swap' })
const lato = Lato({ weight: ['400', '700'], subsets: ['latin'], variable: '--font-lato', display: 'swap' })
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' })
// The Latin fonts above carry no Devanagari glyphs, so "के के खाने?" would fall
// back to whatever the OS supplies. Load a real face for it.
const notoDevanagari = Noto_Sans_Devanagari({
    weight: ['400', '600', '700'],
    subsets: ['devanagari'],
    variable: '--font-devanagari',
    display: 'swap',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#1B263B',
}

export const metadata: Metadata = {
  metadataBase: new URL('https://kkkhane.com'),
  title: {
    default: 'KKKhane | Best SaaS for Cafes & Restaurants in Nepal',
    template: '%s | KKKhane'
  },
  description: 'KKKhane is an ultra-premium SaaS application best for cafes and restaurants. Features include QR Menus, POS, Inventory, and Real-Time Reporting in Nepal.',
  keywords: ['restaurant software', 'cafe POS', 'Nepal POS', 'QR menu', 'restaurant management system', 'KKKhane', 'Bhojad', 'Bharatpur'],
  authors: [{ name: 'KKKhane' }],
  openGraph: {
    title: 'KKKhane | Best SaaS for Cafes & Restaurants in Nepal',
    description: 'An ultra-premium management software. Best for cafes and restaurants in Nepal.',
    url: 'https://kkkhane.com',
    siteName: 'KKKhane',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'KKKhane | Best SaaS for Cafes & Restaurants in Nepal',
    description: 'An ultra-premium management software. Best for cafes and restaurants in Nepal.',
  },
  manifest: '/manifest.json',
  icons: {
    icon: '/icons/kkkhane.png',
    apple: '/icons/icon-192x192.png',
  },
}

// Fetch theme from settings or use defaults
const getThemeConfig = unstable_cache(
  async () => {
    try {
      const supabase = await createAdminClient()
      // Use ORDER BY for deterministic result in single-tenant,
      // and updated_at desc to prefer the most recently edited restaurant's theme
      const { data } = await supabase
        .from('settings')
        .select('theme')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      return data?.theme || {}
    } catch {
      return {}
    }
  },
  ['global-theme-config'],
  { revalidate: 60 }
)

function themeToCSS(theme: Record<string, string>): string {
  const fontMap: Record<string, string> = {
    Inter: 'var(--font-inter), sans-serif',
    Playfair: 'var(--font-playfair), serif',
    Roboto: 'var(--font-roboto), sans-serif',
    Lato: 'var(--font-lato), sans-serif',
    Outfit: 'var(--font-outfit), sans-serif',
  }

  const radiusMap: Record<string, string> = {
    none: '0px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '20px',
    full: '9999px',
  }

  // Support both named keys ("lg") and raw px values ("12px") saved by ThemeCustomizer
  const resolveRadius = (val: string | undefined): string => {
    if (!val) return radiusMap.lg
    if (radiusMap[val]) return radiusMap[val]
    if (/^\d+(\.\d+)?(px|rem|em)$/.test(val)) return val
    return radiusMap.lg
  }

  // Theme colors are restaurant-editable and injected raw into a <style> block,
  // so validate strictly to prevent CSS injection. Allow only hex and the rgb/hsl
  // functional notations; anything else falls back to the default.
  const COLOR_RE = /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/]+\))$/i
  const resolveColor = (val: string | undefined, fallback: string): string =>
    val && COLOR_RE.test(val.trim()) ? val.trim() : fallback

  return `
    :root {
      --color-primary: ${resolveColor(theme.primaryColor, '#FB6303')};
      --color-secondary: ${resolveColor(theme.secondaryColor, '#1B263B')};
      --color-accent: ${resolveColor(theme.accentColor, '#EC4899')};
      --font-family: ${fontMap[theme.fontFamily] || fontMap.Inter};
      --border-radius: ${resolveRadius(theme.borderRadius)};
    }
  `
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const theme = await getThemeConfig()

  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://challenges.cloudflare.com" />
        <link rel="dns-prefetch" href="https://challenges.cloudflare.com" />
        <style dangerouslySetInnerHTML={{ __html: themeToCSS(theme) }} />
      </head>
      <body className={`
        ${inter.variable} ${playfair.variable} ${roboto.variable} ${lato.variable} ${outfit.variable} ${notoDevanagari.variable}
        font-[family-name:var(--font-family)]
        bg-canvas text-ink
        antialiased min-h-screen flex flex-col
      `}>
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === 'development'}
          reloadOnOnline
        >
          {children}
        </SerwistProvider>
        <PwaInstallPrompt />
        <PwaUpdatePrompt />
        {/* Global Overlays */}
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 3000,
            style: {
              background: '#333',
              color: '#fff',
              borderRadius: '12px',
              padding: '12px 20px',
              fontWeight: 500,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            },
            success: {
              iconTheme: { primary: '#4ade80', secondary: '#fff' },
              style: { background: 'white', color: '#1f2937', border: '1px solid #e5e7eb' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#fff' },
              style: { background: 'white', color: '#1f2937', border: '1px solid #e5e7eb' },
            },
          }}
        />
        <ConfirmModal />
      </body>
    </html>
  )
}
