'use client'

import dynamic from 'next/dynamic'

// Leaflet needs the browser DOM. `ssr: false` is only valid inside a Client
// Component (contact/page.tsx is a Server Component) — same pattern as
// src/components/ui/CommandPaletteMount.tsx.
const ContactMap = dynamic(() => import('./ContactMap'), {
    ssr: false,
    loading: () => <div className="w-full h-full bg-surface-muted animate-pulse" />,
})

export default function ContactMapMount() {
    return <ContactMap />
}
