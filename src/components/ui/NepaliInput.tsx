'use client'

import React, { useState, useLayoutEffect, useRef } from 'react'
import nepalify from 'nepalify'
import { Languages } from 'lucide-react'

interface NepaliInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
    value: string
    onChange: (val: string) => void
    defaultIsNepali?: boolean
}

/**
 * A text field that can type Devanagari, using the standard Nepali Romanized
 * keyboard layout.
 *
 * The layout is a key-for-glyph map, not a phonetic transliterator: `k` is क and
 * `K` is ख, so खाना is typed `K` `a` `n` `a`. It is not spelling the word out in
 * English — someone typing "khana" gets कहाना, because `h` is ह in its own right.
 * That is the layout Nepali typists already use, and it is the whole of what
 * nepalify offers (`interceptElementById` looks up the same single key).
 *
 * Conversion happens per keystroke, at the caret. It used to run over the whole
 * field value on every change, which quietly rewrote text the keystroke never
 * touched: a category already saved as "Burger" turned into "भुरगेरस" the moment
 * anyone typed one more character with the toggle on. Mapping only the key that
 * was actually pressed leaves existing text — and pasted text — alone.
 */
export function NepaliInput({ value, onChange, defaultIsNepali = false, className, ...props }: NepaliInputProps) {
    const [isNepali, setIsNepali] = useState(defaultIsNepali)
    const inputRef = useRef<HTMLInputElement>(null)
    // Where the caret belongs once React has painted the value we just built.
    // Replacing a controlled input's value otherwise parks it at the end, which
    // makes correcting a typo mid-word impossible.
    const caretRef = useRef<number | null>(null)

    useLayoutEffect(() => {
        const pos = caretRef.current
        if (pos === null) return
        caretRef.current = null
        inputRef.current?.setSelectionRange(pos, pos)
    })

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isNepali) return
        // Anything that isn't a self-inserting character types itself: Backspace,
        // Enter, Tab, the arrow keys, and every shortcut chord — intercepting
        // those would break select-all and paste.
        if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
        // Mid-composition an IME owns the keystroke; taking it produces doubled text.
        if (e.nativeEvent.isComposing) return

        const el = e.currentTarget
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? start

        // format() of a single character is the layout lookup, falling back to
        // the character itself — so space and punctuation still insert normally.
        const mapped: string = nepalify.format(e.key)
        const next = el.value.slice(0, start) + mapped + el.value.slice(end)

        e.preventDefault()
        caretRef.current = start + mapped.length
        onChange(next)
    }

    // Backspace, cut, paste, autofill and drag-drop all land here, and all of
    // them pass through unconverted — pasting English while the toggle is on
    // keeps the English.
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
    }

    return (
        <div className="relative group w-full">
            <input
                {...props}
                ref={inputRef}
                value={value}
                onKeyDown={handleKeyDown}
                onChange={handleChange}
                className={`${className} pr-10`}
                lang={isNepali ? 'ne' : undefined}
            />
            <button
                type="button"
                onClick={() => setIsNepali(!isNepali)}
                aria-pressed={isNepali}
                aria-label="Type in Nepali"
                className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors flex items-center justify-center
                    ${isNepali
                        ? 'bg-brand-100 text-brand-600 hover:bg-brand-200'
                        : 'text-ink-subtle hover:bg-surface-muted hover:text-ink-muted'
                    }`}
                title={isNepali ? 'Nepali Romanized keyboard — K types ख, k types क' : 'Typing in English'}
            >
                <Languages size={16} />
            </button>
        </div>
    )
}
