"use client"

import { useEffect, useState } from 'react'

export default function RandomStatCounter({ suffix = '' }: { suffix?: string }) {
    const [value, setValue] = useState(0)

    useEffect(() => {
        // Generates 10 numbers per second randomly
        const interval = setInterval(() => {
            setValue(Math.floor(Math.random() * 9999))
        }, 100)
        return () => clearInterval(interval)
    }, [])

    return <span>{value.toLocaleString()}{suffix}</span>
}
