'use client'

import React, { useState, useEffect } from 'react'
import nepalify from 'nepalify'
import { Languages } from 'lucide-react'

interface NepaliInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value: string
    onChange: (val: string) => void
    defaultIsNepali?: boolean
}

export function NepaliInput({ value, onChange, defaultIsNepali = false, className, ...props }: NepaliInputProps) {
    const [isNepali, setIsNepali] = useState(defaultIsNepali)
    const [localVal, setLocalVal] = useState(value)

    useEffect(() => {
        setLocalVal(value)
    }, [value])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value
        // nepalify.format takes romanized and returns devanagari
        const parsed = isNepali ? nepalify.format(raw) : raw
        setLocalVal(parsed)
        onChange(parsed)
    }

    return (
        <div className="relative group w-full">
            <input
                {...props}
                value={localVal}
                onChange={handleChange}
                className={`${className} pr-10`}
            />
            <button
                type="button"
                onClick={() => setIsNepali(!isNepali)}
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors flex items-center justify-center
                    ${isNepali 
                        ? 'bg-brand-100 text-brand-600 hover:bg-brand-200' 
                        : 'text-ink-subtle hover:bg-surface-muted hover:text-ink-muted'
                    }`}
                title={isNepali ? "Typing in Nepali (Devanagari)" : "Typing in English"}
            >
                <Languages size={16} />
            </button>
        </div>
    )
}
