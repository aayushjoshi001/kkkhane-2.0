'use client'

// Drop-in replacement for a native <select> — the browser draws a native
// <select>'s open dropdown itself (OS chrome), so no amount of CSS can put
// the app's brand color on it. This renders the whole list ourselves instead.
//
// Usage mirrors a native select exactly: pass the same <option> children,
// value, and onChange — onChange receives a { target: { value } } shape so
// existing `e => setX(e.target.value)` handlers work unmodified.

import { useEffect, useRef, useState, Children, isValidElement, type ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'

interface SelectChangeEvent {
    target: { value: string }
}

interface OptionLike {
    value: string
    label: string
    disabled?: boolean
}

function textOf(node: ReactNode): string {
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(textOf).join('')
    return ''
}

function extractOptions(children: ReactNode): OptionLike[] {
    const opts: OptionLike[] = []
    Children.forEach(children, child => {
        if (!isValidElement(child)) return
        const props = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode }
        opts.push({
            // <option value={n}> with a numeric value is valid JSX (native
            // select coerces it); stringify so comparisons against `value`
            // (always a string here) still match.
            value: props.value === undefined ? '' : String(props.value),
            label: textOf(props.children),
            disabled: props.disabled,
        })
    })
    return opts
}

export default function Select({
    value,
    onChange,
    children,
    className = '',
    disabled = false,
    id,
    'aria-label': ariaLabel,
}: {
    value: string
    onChange: (e: SelectChangeEvent) => void
    children: ReactNode
    className?: string
    disabled?: boolean
    required?: boolean
    id?: string
    name?: string
    autoFocus?: boolean
    title?: string
    'aria-label'?: string
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const options = extractOptions(children)
    const selected = options.find(o => o.value === value)

    useEffect(() => {
        if (!open) return
        function onDocClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onDocClick)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDocClick)
            document.removeEventListener('keydown', onKey)
        }
    }, [open])

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                id={id}
                disabled={disabled}
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 border-hairline rounded-[var(--r-md)] shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] focus:outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 sm:text-sm p-3 border bg-surface text-ink transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <span className={`truncate text-left ${selected && selected.value ? 'font-semibold text-ink' : 'text-ink-subtle'}`}>
                    {selected ? selected.label : ''}
                </span>
                <ChevronDown size={16} className={`text-ink-subtle shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div
                    role="listbox"
                    className="absolute z-50 mt-1.5 w-full max-h-64 overflow-y-auto bg-surface border border-hairline rounded-[var(--r-md)] shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-150"
                >
                    {options.map((opt, i) => (
                        <button
                            key={`${opt.value}-${i}`}
                            type="button"
                            role="option"
                            aria-selected={opt.value === value}
                            disabled={opt.disabled}
                            onClick={() => {
                                if (opt.disabled) return
                                onChange({ target: { value: opt.value } })
                                setOpen(false)
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm text-left transition-colors ${
                                opt.value === value ? 'bg-brand-50 text-brand-700 font-bold' : 'text-ink hover:bg-surface-muted font-semibold'
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                            <span className="truncate">{opt.label}</span>
                            {opt.value === value && <Check size={14} className="text-brand-500 shrink-0" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    )
}
