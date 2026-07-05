'use client'

import { useState } from 'react'
import { MarketingNav, MarketingFooter, Eyebrow } from '@/components/marketing'

export default function ContactPage() {
    const [formState, setFormState] = useState({ name: '', email: '', message: '', phone: '' })
    const [submitted, setSubmitted] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitted(true)
        setFormState({ name: '', email: '', message: '', phone: '' })
        setTimeout(() => setSubmitted(false), 3000)
    }

    const inputCls =
        'w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none transition focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20'

    return (
        <div className="min-h-screen bg-white text-gray-900">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-white pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-[var(--color-primary)]/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="brand">Contact Us</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-gray-900 md:text-7xl">
                        Get in <span className="text-[var(--color-primary)]">Touch</span>
                    </h1>
                    <p className="mx-auto mt-8 max-w-xl text-xl font-medium leading-relaxed text-gray-500">
                        Have questions? Our team is here to help. Get in touch and we&apos;ll get back to you as soon as possible.
                    </p>
                </div>
            </section>

            {/* Contact form */}
            <section className="bg-[#FAFAF8] pb-24 pt-4">
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <div className="grid gap-12 rounded-3xl border border-gray-100 bg-white p-8 shadow-xl md:grid-cols-5 md:p-12 lg:gap-20">
                        {/* Form */}
                        <div className="md:col-span-3">
                            <h2 className="mb-8 text-3xl font-extrabold tracking-tight text-gray-900">Send a Message</h2>
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
                        </div>

                        {/* Info */}
                        <div className="h-fit space-y-10 rounded-2xl border border-gray-100 bg-[#FAFAF8] p-8 md:col-span-2">
                            <div>
                                <h3 className="mb-3 text-xl font-extrabold text-gray-900">Direct Contact</h3>
                                <div className="space-y-4">
                                    <a href="mailto:hello@kkkhane.com" className="flex items-center gap-3 font-medium text-gray-600 transition hover:text-[var(--color-primary)]">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">📧</div>
                                        hello@kkkhane.com
                                    </a>
                                    <a href="tel:+9779800000000" className="flex items-center gap-3 font-medium text-gray-600 transition hover:text-[var(--color-primary)]">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">📞</div>
                                        +977 9800000000
                                    </a>
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-3 text-xl font-extrabold text-gray-900">Headquarters</h3>
                                <div className="flex items-start gap-3 font-medium text-gray-600">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">📍</div>
                                    <p className="mt-2">Kathmandu, Nepal<br />South Asia</p>
                                </div>
                            </div>
                            <div className="border-t border-gray-200 pt-6">
                                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-gray-400">Connect on Social</h3>
                                <div className="flex gap-3">
                                    {['Twitter', 'Facebook', 'Instagram', 'LinkedIn'].map((social) => (
                                        <a key={social} href="#" className="flex-1 rounded-lg border border-gray-200 bg-white py-2.5 text-center text-sm font-bold text-gray-600 shadow-sm transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                                            {social}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Google Map Section */}
            <section className="bg-white pt-10 pb-24">
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-extrabold tracking-tight text-gray-900">Find Us Here</h2>
                        <p className="text-gray-500 font-medium mt-3">Visit our headquarters in the heart of Kathmandu.</p>
                    </div>
                    <div className="w-full h-[450px] rounded-[2.5rem] overflow-hidden shadow-2xl border-8 border-gray-50 relative group">
                        <iframe 
                            src="https://maps.google.com/maps?q=Kathmandu,+Nepal&t=&z=13&ie=UTF8&iwloc=&output=embed" 
                            width="100%" 
                            height="100%" 
                            style={{ border: 0 }} 
                            allowFullScreen 
                            loading="lazy" 
                            referrerPolicy="no-referrer-when-downgrade"
                            className="filter grayscale contrast-[1.1] hover:grayscale-0 transition-all duration-1000 ease-in-out z-0"
                        />
                        
                        {/* Premium Glassmorphic Overlay */}
                        <div className="absolute top-6 left-6 md:top-8 md:left-8 bg-white/80 backdrop-blur-xl p-5 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/50 z-10 transform transition-transform group-hover:-translate-y-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-gray-900 text-base">Global HQ</h3>
                                    <p className="text-gray-500 font-bold text-xs uppercase tracking-wider">Kathmandu, Nepal</p>
                                </div>
                            </div>
                            <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="block text-center w-full py-2 mt-3 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-black transition-colors">
                                Get Directions
                            </a>
                        </div>

                        {/* Animated pulsing dot on map center (CSS trick for premium feel) */}
                        <div className="absolute top-[48%] left-[50%] -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                            <div className="w-6 h-6 bg-[var(--color-primary)] rounded-full animate-ping opacity-60" />
                            <div className="w-3 h-3 bg-[var(--color-primary)] rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-lg shadow-[var(--color-primary)]" />
                        </div>
                    </div>
                </div>
            </section>

            <MarketingFooter />
        </div>
    )
}
