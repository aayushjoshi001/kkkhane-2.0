'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import Image from 'next/image'
import { ArrowLeft, ArrowRight, Loader2, Phone, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Turnstile } from '@marsidev/react-turnstile'
import { sendPhoneOtp } from '@/app/api/customer/auth/actions'

export default function LoginClient({ restaurant }: { restaurant: any }) {
    const [phone, setPhone] = useState('')
    const [otp, setOtp] = useState('')
    const [step, setStep] = useState<'phone' | 'otp'>('phone')
    const [loading, setLoading] = useState(false)
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
    const router = useRouter()
    const supabase = createClient()

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!phone || phone.length < 10) {
            toast.error('Please enter a valid phone number')
            return
        }

        setLoading(true)
        // Normalize phone for Supabase
        const formattedPhone = phone.startsWith('+') ? phone : `+977${phone}`
        
        try {
            const res = await sendPhoneOtp(formattedPhone, turnstileToken)
            if (res?.error) throw new Error(res.error)
            
            setStep('otp')
            toast.success('Verification code sent!')
        } catch (err: any) {
            toast.error(err.message || 'Failed to send OTP')
        } finally {
            setLoading(false)
        }
    }

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!otp || otp.length !== 6) {
            toast.error('Please enter the 6-digit code')
            return
        }

        setLoading(true)
        const formattedPhone = phone.startsWith('+') ? phone : `+977${phone}`
        try {
            const { error } = await supabase.auth.verifyOtp({
                phone: formattedPhone,
                token: otp,
                type: 'sms'
            })
            if (error) throw error
            
            toast.success('Logged in successfully!')
            // Redirect to their profile
            router.push(`/r/${restaurant.slug}/profile`)
            router.refresh()
        } catch (err: any) {
            toast.error(err.message || 'Invalid code')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col relative overflow-hidden">
            {/* Minimal Header */}
            <header className="p-4 flex items-center justify-between relative z-10">
                <Link href={`/r/${restaurant.slug}`} className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100 text-gray-500 hover:text-gray-900 transition-colors">
                    <ArrowLeft size={20} />
                </Link>
                <div className="font-bold text-gray-800">{restaurant.name}</div>
                <div className="w-10" />
            </header>

            <main className="flex-1 flex flex-col items-center justify-center p-4 relative z-10">
                <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-[0_16px_60px_rgba(0,0,0,0.05)] border border-gray-100 text-center">
                    {/* Brand or Icon */}
                    <div className="w-20 h-20 bg-gray-50 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-inner border border-gray-100">
                        {restaurant.logo_url ? (
                            <Image src={restaurant.logo_url} alt="Logo" width={48} height={48} className="object-contain" />
                        ) : (
                            <ShieldCheck size={36} className="text-brand-500" />
                        )}
                    </div>

                    <h1 className="text-2xl font-bold text-gray-900 mb-2">
                        {step === 'phone' ? 'Welcome Back' : 'Verify Your Number'}
                    </h1>
                    <p className="text-sm text-gray-500 mb-8 font-medium">
                        {step === 'phone' 
                            ? 'Enter your phone number to access your profile and loyalty points.' 
                            : `We sent a 6-digit code to ${phone}`
                        }
                    </p>

                    {step === 'phone' ? (
                        <form onSubmit={handleSendOtp} className="space-y-4">
                            <div className="relative">
                                <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="tel"
                                    placeholder="Mobile Number (e.g. 98...)"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3.5 pl-12 pr-4 text-gray-900 font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all shadow-sm"
                                    autoFocus
                                />
                            </div>
                            
                            {process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
                                <div className="flex justify-center mt-4">
                                    <Turnstile 
                                        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} 
                                        onSuccess={(token) => setTurnstileToken(token)}
                                        options={{ theme: 'light', size: 'normal' }}
                                    />
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || phone.length < 10 || (!!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)}
                                className="w-full bg-brand-500 text-white font-bold py-3.5 rounded-xl hover:bg-brand-600 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-lg shadow-brand-500/25"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Continue'}
                                {!loading && <ArrowRight size={18} />}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleVerifyOtp} className="space-y-4">
                            <input
                                type="text"
                                inputMode="numeric"
                                placeholder="0 0 0 0 0 0"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3.5 px-4 text-center text-2xl tracking-[1em] font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 transition-all shadow-sm"
                                autoFocus
                            />
                            <button
                                type="submit"
                                disabled={loading || otp.length !== 6}
                                className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-xl hover:bg-black active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center gap-2 shadow-lg"
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : 'Verify & Login'}
                            </button>
                            
                            <button
                                type="button"
                                onClick={() => { setStep('phone'); setOtp('') }}
                                className="text-sm font-bold text-gray-400 hover:text-gray-600 transition-colors mt-4 block mx-auto"
                            >
                                Use a different number
                            </button>
                        </form>
                    )}
                </div>
            </main>
        </div>
    )
}
