'use client'

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix for default marker icons in Next.js/Webpack
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

export default function OpenStreetMap({ address, embedUrl }: { address?: string, embedUrl?: string }) {
    const [coords, setCoords] = useState<[number, number] | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // If they provided a raw iframe embed URL, we don't need to geocode.
        // We will just render an iframe.
        if (embedUrl || !address) {
            setLoading(false)
            return
        }
        
        // Simple Nominatim geocoding for open-source mapping without API keys
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`)
            .then(res => res.json())
            .then(data => {
                if (data && data.length > 0) {
                    setCoords([parseFloat(data[0].lat), parseFloat(data[0].lon)])
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [address, embedUrl])

    if (embedUrl) {
        return (
            <iframe
                src={embedUrl}
                title="Map"
                className="w-full h-full min-h-[260px] border-0"
                loading="lazy"
            />
        )
    }

    if (loading) return <div className="w-full h-full min-h-[260px] flex items-center justify-center bg-surface-muted text-ink-subtle animate-pulse">Finding location...</div>
    if (!coords) return <div className="w-full h-full min-h-[260px] flex items-center justify-center bg-surface-muted text-ink-subtle">Map unavailable for this address</div>

    return (
        <div style={{ height: '100%', minHeight: '260px', width: '100%' }}>
            <MapContainer center={coords} zoom={15} scrollWheelZoom={false} style={{ height: '100%', width: '100%', zIndex: 10 }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={coords}>
                    <Popup>{address}</Popup>
                </Marker>
            </MapContainer>
        </div>
    )
}
