'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export default function MapUpdater({ center }: { center: { lat: number, lng: number } | null }) {
    const map = useMap()
    
    useEffect(() => {
        if (center) {
            map.flyTo([center.lat, center.lng], 15)
        }
    }, [center, map])
    
    return null
}
