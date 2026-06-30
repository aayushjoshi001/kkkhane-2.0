'use client'

import { useEffect } from 'react'
import { useMap, useMapEvents } from 'react-leaflet'
import type { LeafletMouseEvent } from 'leaflet'

/**
 * Handles map clicks and dynamically updates/pans the map view center 
 * when the coordinates change (e.g. via Geolocation).
 */
export default function MapController({
    onLocationSelect,
    center,
}: {
    onLocationSelect: (lat: number, lng: number) => void
    center?: [number, number] | null
}) {
    const map = useMap()

    useMapEvents({
        click(e: LeafletMouseEvent) {
            onLocationSelect(e.latlng.lat, e.latlng.lng)
        },
    })

    useEffect(() => {
        if (center && center[0] && center[1]) {
            map.setView(center, 15, { animate: true })
        }
    }, [center, map])

    return null
}
