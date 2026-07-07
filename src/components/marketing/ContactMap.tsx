'use client'

import { MapContainer, TileLayer, Marker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

// Fix for default marker icons in Next.js/Webpack — same pattern as
// src/components/customer/homepage/sections/OpenStreetMap.tsx
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

// Same coordinates the previous Google Maps embed was centered on (Kathmandu HQ)
const KATHMANDU_HQ: [number, number] = [27.708942726359302, 85.2506553888373]

export default function ContactMap() {
    return (
        <MapContainer
            center={KATHMANDU_HQ}
            zoom={15}
            scrollWheelZoom={false}
            style={{ height: '100%', width: '100%' }}
            className="filter grayscale contrast-[1.1] hover:grayscale-0 transition-all duration-1000 ease-in-out"
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={KATHMANDU_HQ} />
        </MapContainer>
    )
}
