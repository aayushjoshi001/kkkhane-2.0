import { MarketingNav, MarketingFooter, Eyebrow } from '@/components/marketing'
import ContactForm from '@/components/marketing/ContactForm'
import ContactMapMount from '@/components/marketing/ContactMapMount'

export default function ContactPage() {
    return (
        <div className="min-h-screen bg-surface text-ink">
            <MarketingNav />

            {/* Hero */}
            <section className="relative overflow-hidden bg-surface pb-14 pt-36 text-center">
                <div className="pointer-events-none absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-[var(--color-primary)]/5 blur-[120px]" />
                <div className="relative mx-auto max-w-3xl px-4 sm:px-6">
                    <Eyebrow tone="brand">Contact Us</Eyebrow>
                    <h1 className="mt-6 text-5xl font-extrabold tracking-tight text-ink md:text-7xl">
                        Get in <span className="text-[var(--color-primary)]">Touch</span>
                    </h1>
                    <p className="mx-auto mt-8 max-w-xl text-xl font-medium leading-relaxed text-ink-subtle">
                        Have questions? Our team is here to help. Get in touch and we&apos;ll get back to you as soon as possible.
                    </p>
                </div>
            </section>

            {/* Contact form */}
            <section className="bg-transparent pb-24 pt-4">
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <div className="grid gap-12 rounded-3xl border border-hairline bg-surface p-8 shadow-xl md:grid-cols-5 md:p-12 lg:gap-20">
                        {/* Form */}
                        <div className="md:col-span-3">
                            <h2 className="mb-8 text-3xl font-extrabold tracking-tight text-ink">Send a Message</h2>
                            <ContactForm />
                        </div>

                        {/* Info */}
                        <div className="h-fit space-y-10 rounded-2xl border border-hairline bg-transparent p-8 md:col-span-2">
                            <div>
                                <h3 className="mb-3 text-xl font-extrabold text-ink">Direct Contact</h3>
                                <div className="space-y-4">
                                    <a href="mailto:info.kkkhane@gmail.com" className="flex items-center gap-3 font-medium text-ink-muted transition hover:text-[var(--color-primary)]">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-surface shadow-sm">📧</div>
                                        <div className="text-sm">Sales: info.kkkhane@gmail.com</div>
                                    </a>
                                    <a href="mailto:siddantasodari123@gmail.com" className="flex items-center gap-3 font-medium text-ink-muted transition hover:text-[var(--color-primary)]">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-surface shadow-sm">✉️</div>
                                        <div className="text-sm">Gen: siddantasodari123@gmail.com</div>
                                    </a>
                                    <a href="tel:+9779765662427" className="flex items-center gap-3 font-medium text-ink-muted transition hover:text-[var(--color-primary)]">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-hairline bg-surface shadow-sm">📞</div>
                                        +977 9765662427
                                    </a>
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-3 text-xl font-extrabold text-ink">Headquarters</h3>
                                <div className="flex items-start gap-3 font-medium text-ink-muted">
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface shadow-sm">📍</div>
                                    <p className="mt-2 text-sm">Bhojad, Bharatpur<br />Nepal</p>
                                </div>
                            </div>
                            <div className="border-t border-hairline-strong pt-6">
                                <h3 className="mb-4 text-sm font-bold uppercase tracking-wider text-ink-subtle">Connect on Social</h3>
                                <div className="flex gap-2">
                                    {[
                                        { name: 'Facebook', url: 'https://www.facebook.com/profile.php?id=61591962652382' },
                                        { name: 'Instagram', url: 'https://www.instagram.com/kkkhane_/' },
                                        { name: 'LinkedIn', url: 'https://www.linkedin.com/company/kkkhane/?viewAsMember=true' }
                                    ].map((social) => (
                                        <a key={social.name} href={social.url} target="_blank" rel="noopener noreferrer" className="flex-1 rounded-lg border border-hairline-strong bg-surface py-2 text-center text-[11px] sm:text-xs font-bold text-ink-muted shadow-sm transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]">
                                            {social.name}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Google Map Section */}
            <section className="bg-surface pt-10 pb-24">
                <div className="mx-auto max-w-6xl px-4 sm:px-6">
                    <div className="text-center mb-10">
                        <h2 className="text-3xl font-extrabold tracking-tight text-ink">Find Us Here</h2>
                        <p className="text-ink-subtle font-medium mt-3">Visit our headquarters in Bhojad, Bharatpur.</p>
                    </div>
                    <div className="w-full h-[450px] rounded-[2.5rem] overflow-hidden shadow-2xl border-8 border-gray-50 relative group">
                        <div className="absolute inset-0 z-0">
                            <ContactMapMount />
                        </div>

                        {/* Premium Glassmorphic Overlay */}
                        <div className="absolute top-6 left-6 md:top-8 md:left-8 bg-surface/80 backdrop-blur-xl p-5 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-white/50 z-10 transform transition-transform group-hover:-translate-y-1">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)]">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                                </div>
                                <div>
                                    <h3 className="font-extrabold text-ink text-base">Global HQ</h3>
                                    <p className="text-ink-subtle font-bold text-xs uppercase tracking-wider">Bhojad, Bharatpur</p>
                                </div>
                            </div>
                            <a href="https://maps.google.com" target="_blank" rel="noopener noreferrer" className="block text-center w-full py-2 mt-3 bg-ink text-white rounded-xl text-xs font-bold hover:bg-black transition-colors">
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
