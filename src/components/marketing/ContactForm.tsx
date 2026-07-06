'use client'

import { useState } from 'react'

const inputCls =
    'w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20'

export default function ContactForm() {
    const [formState, setFormState] = useState({ name: '', email: '', message: '', phone: '' })
    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitted(true)
        setFormState({ name: '', email: '', message: '', phone: '' })
        setTimeout(() => setSubmitted(false), 3000)
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {submitted && (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 p-4 font-medium text-green-700">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100">✓</div>
                    Thank you! We&apos;ll get back to you soon.
                </div>
            )}
            <div className="grid gap-6 sm:grid-cols-2">
                <div>
                    <label className="mb-2 block text-sm font-bold text-gray-700">Name</label>
                    <input type="text" required value={formState.name}
                        onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                        className={inputCls} placeholder="Your name" />
                </div>
                <div>
                    <label className="mb-2 block text-sm font-bold text-gray-700">Phone (Optional)</label>
                    <input type="tel" value={formState.phone}
                        onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                        className={inputCls} placeholder="+977 98XXXXXXXX" />
                </div>
            </div>
            <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">Email</label>
                <input type="email" required value={formState.email}
                    onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                    className={inputCls} placeholder="your@email.com" />
            </div>
            <div>
                <label className="mb-2 block text-sm font-bold text-gray-700">Message</label>
                <textarea required value={formState.message}
                    onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                    rows={5}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 p-4 font-medium outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20"
                    placeholder="Tell us about your inquiry..." />
            </div>
            <button type="submit"
                className="w-full rounded-full bg-[var(--color-primary)] py-4 text-lg font-bold text-white shadow-lg shadow-[var(--color-primary)]/20 transition-transform hover:scale-[1.02]">
                Send Message
            </button>
        </form>
    )
}
