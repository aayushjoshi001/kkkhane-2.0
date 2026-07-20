import { cn } from '@/lib/utils'
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import Select from '@/components/ui/Select'

export const fieldClasses =
    'w-full px-3.5 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink ' +
    'placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ' +
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

function FieldShell({
    label,
    required,
    error,
    hint,
    children,
}: {
    label: string
    required?: boolean
    error?: string
    hint?: string
    children: ReactNode
}) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">
                {label}
                {required && <span className="text-danger ml-0.5">*</span>}
            </span>
            {children}
            {error ? (
                <span className="text-[11px] font-semibold text-danger">{error}</span>
            ) : hint ? (
                <span className="text-[11px] text-ink-subtle">{hint}</span>
            ) : null}
        </label>
    )
}

export interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label: string
    error?: string
    hint?: string
}

export function FormInput({ label, error, hint, required, className, ...props }: FormInputProps) {
    return (
        <FieldShell label={label} required={required} error={error} hint={hint}>
            <input
                required={required}
                className={cn(fieldClasses, error && 'border-danger focus:ring-danger/30 focus:border-danger', className)}
                {...props}
            />
        </FieldShell>
    )
}

export interface FormSelectProps {
    label: string
    error?: string
    hint?: string
    value: string
    onChange: (e: { target: { value: string } }) => void
    children: ReactNode
    className?: string
    disabled?: boolean
    required?: boolean
    searchable?: boolean
}

export function FormSelect({ label, error, hint, required, className, children, ...props }: FormSelectProps) {
    return (
        <FieldShell label={label} required={required} error={error} hint={hint}>
            <Select
                required={required}
                className={cn(fieldClasses, error && 'border-danger focus:ring-danger/30 focus:border-danger', className)}
                {...props}
            >
                {children}
            </Select>
        </FieldShell>
    )
}

export interface FormTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label: string
    error?: string
    hint?: string
}

export function FormTextarea({ label, error, hint, required, className, ...props }: FormTextareaProps) {
    return (
        <FieldShell label={label} required={required} error={error} hint={hint}>
            <textarea
                required={required}
                className={cn(fieldClasses, 'min-h-[80px] resize-y', error && 'border-danger focus:ring-danger/30 focus:border-danger', className)}
                {...props}
            />
        </FieldShell>
    )
}
