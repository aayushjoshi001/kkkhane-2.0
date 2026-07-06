'use client'

import { useState, useEffect } from 'react'
import { UserCircle, X, History, Star, LogOut, ChevronRight, Mail, Phone, Lock, User as UserIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { signUpCustomerWithEmail, loginWithEmail, sendPhoneOtp, verifyPhoneOtp } from '@/app/api/customer/auth/actions'
import { toast } from 'react-hot-toast'
import { createBrowserClient } from '@supabase/ssr'
import { Turnstile } from '@marsidev/react-turnstile'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export default function CustomerProfileSheet({ isOpen, onClose, restaurantId }: { isOpen: boolean, onClose: () => void, restaurantId: string }) {
    const [isLoggedIn, setIsLoggedIn] = useState(false)
    const [authMode, setAuthMode] = useState<'login' | 'signup'>('signup')
    const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email')
    const [customerData, setCustomerData] = useState<any>(null)
    
    const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    useEffect(() => {
        if (!isOpen) return
        // Check session when modal opens
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setIsLoggedIn(true)
                // Optionally fetch loyalty member data
                supabase.from('loyalty_members').select('*').eq('auth_user_id', session.user.id).single().then(({ data }) => {
                    if (data) setCustomerData(data)
                })
            } else {
                setIsLoggedIn(false)
                setCustomerData(null)
            }
        })
    }, [isOpen, supabase])
    
    // Form fields
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [phone, setPhone] = useState('')
    const [name, setName] = useState('')
    const [otpToken, setOtpToken] = useState('')
    
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [showOtpInput, setShowOtpInput] = useState(false)

    async function handleAuthSubmit() {
        setLoading(true)
        try {
            if (showOtpInput) {
                const res = await verifyPhoneOtp(phone, otpToken, restaurantId)
                if (res.error) throw new Error(res.error)
                toast.success('Successfully logged in!')
                setIsLoggedIn(true)
                setShowOtpInput(false)
            } else if (authMethod === 'phone') {
                if (!phone.startsWith('+')) {
                    throw new Error('Please include country code (e.g., +1234567890)')
                }
                const res = await sendPhoneOtp(phone)
                if (res.error) throw new Error(res.error)
                setShowOtpInput(true)
                toast.success('OTP code sent!')
            } else {
                if (authMode === 'signup') {
                    if (!name) throw new Error('Name is required')
                    if (!email) throw new Error('Email is required')
                    if (!password || password.length < 6) throw new Error('Password must be at least 6 characters')
                    
                    const res = await signUpCustomerWithEmail(email, password, phone, name, restaurantId, turnstileToken)
                    if (res.error) throw new Error(res.error)
                    toast.success('Account created successfully!')
                    setIsLoggedIn(true)
                } else {
                    if (!email || !password) throw new Error('Email and password are required')
                    const res = await loginWithEmail(email, password, turnstileToken)
                    if (res.error) throw new Error(res.error)
                    toast.success('Successfully logged in!')
                    setIsLoggedIn(true)
                }
            }
        } catch (error: any) {
            toast.error(error.message || 'An error occurred')
        } finally {
            setLoading(false)
        }
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                    />
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed inset-x-0 bottom-0 z-[101] bg-white rounded-t-3xl overflow-hidden max-h-[90vh] flex flex-col"
                    >
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <h2 className="text-lg font-black text-gray-900">
                                {isLoggedIn ? 'My Profile' : 'Sign In'}
                            </h2>
                            <button onClick={onClose} className="p-2 -mr-2 bg-gray-100 rounded-full text-gray-500 hover:text-gray-900">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5">
                            {!isLoggedIn ? (
                                <div className="space-y-6 pb-8">
                                    <div className="text-center">
                                        <div className="w-16 h-16 bg-brand-100 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-4">
                                            <Star size={32} />
                                        </div>
                                        <h3 className="text-xl font-black text-gray-900 mb-2">Join Our Loyalty Program</h3>
                                        <p className="text-sm text-gray-500">Sign in to earn points, track your orders, and unlock exclusive rewards.</p>
                                    </div>

                                    {/* Auth Method Toggle */}
                                    {!showOtpInput && (
                                        <div className="flex p-1 bg-gray-100 rounded-xl mb-6">
                                            <button 
                                                onClick={() => setAuthMethod('email')}
                                                className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", authMethod === 'email' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                                            >
                                                Email
                                            </button>
                                            <button 
                                                onClick={() => setAuthMethod('phone')}
                                                className={cn("flex-1 py-2 text-sm font-bold rounded-lg transition-colors", authMethod === 'phone' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700")}
                                            >
                                                Phone (OTP)
                                            </button>
                                        </div>
                                    )}

                                    <div className="space-y-4">
                                        {showOtpInput ? (
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Verification Code</label>
                                                <div className="relative">
                                                    <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                    <input 
                                                        type="text" 
                                                        value={otpToken}
                                                        onChange={e => setOtpToken(e.target.value)}
                                                        placeholder="Enter 6-digit code" 
                                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                    />
                                                </div>
                                            </div>
                                        ) : authMethod === 'email' ? (
                                            <>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Email</label>
                                                    <div className="relative">
                                                        <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                        <input 
                                                            type="email" 
                                                            value={email}
                                                            onChange={e => setEmail(e.target.value)}
                                                            placeholder="Enter your email" 
                                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                        />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Password</label>
                                                    <div className="relative">
                                                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                        <input 
                                                            type="password" 
                                                            value={password}
                                                            onChange={e => setPassword(e.target.value)}
                                                            placeholder="Enter password" 
                                                            className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                        />
                                                    </div>
                                                </div>
                                                {authMode === 'signup' && (
                                                    <>
                                                        <div>
                                                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Full Name</label>
                                                            <div className="relative">
                                                                <UserIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                                <input 
                                                                    type="text" 
                                                                    value={name}
                                                                    onChange={e => setName(e.target.value)}
                                                                    placeholder="John Doe" 
                                                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                                />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Phone (Optional)</label>
                                                            <div className="relative">
                                                                <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                                <input 
                                                                    type="tel" 
                                                                    value={phone}
                                                                    onChange={e => setPhone(e.target.value)}
                                                                    placeholder="For loyalty points" 
                                                                    className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                                />
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </>
                                        ) : (
                                            <div>
                                                <label className="block text-xs font-bold text-gray-700 uppercase mb-1.5">Phone Number</label>
                                                <div className="relative">
                                                    <Phone size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                                                    <input 
                                                        type="tel" 
                                                        value={phone}
                                                        onChange={e => setPhone(e.target.value)}
                                                        placeholder="+1234567890" 
                                                        className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-11 pr-4 py-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white transition-colors"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        
                                        {!showOtpInput && authMethod === 'email' && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
                                            <div className="flex justify-center mb-2">
                                                <Turnstile 
                                                    siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY} 
                                                    onSuccess={(token) => setTurnstileToken(token)}
                                                    options={{ theme: 'light', size: 'normal' }}
                                                />
                                            </div>
                                        )}
                                        
                                        <button 
                                            onClick={handleAuthSubmit}
                                            disabled={loading || (!showOtpInput && authMethod === 'email' && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !turnstileToken)}
                                            className="w-full bg-brand-500 text-white font-black py-4 rounded-xl shadow-lg shadow-brand-500/25 hover:bg-brand-600 active:scale-[0.98] transition-all disabled:opacity-70"
                                        >
                                            {loading ? 'Processing...' : showOtpInput ? 'Verify Code' : authMethod === 'phone' ? 'Send OTP Code' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
                                        </button>
                                        
                                        <p className="text-center text-sm text-gray-500 mt-4">
                                            {authMode === 'signup' ? 'Already have an account? ' : 'New here? '}
                                            <button 
                                                onClick={() => setAuthMode(m => m === 'signup' ? 'login' : 'signup')}
                                                className="font-bold text-brand-600 hover:underline"
                                            >
                                                {authMode === 'signup' ? 'Sign In' : 'Sign Up'}
                                            </button>
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-8 pb-8">
                                    <div className="flex items-center gap-4">
                                        <div className="w-16 h-16 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 text-2xl font-black shrink-0 uppercase">
                                            {customerData?.display_name?.[0] || customerData?.email?.[0] || customerData?.phone?.[0] || 'U'}
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-xl font-black text-gray-900 truncate">{customerData?.display_name || 'Customer'}</h3>
                                            <p className="text-sm text-gray-500 truncate">{customerData?.phone || customerData?.email}</p>
                                        </div>
                                    </div>

                                    {/* Loyalty Card */}
                                    <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-5 text-white shadow-xl relative overflow-hidden">
                                        <div className="absolute top-0 right-0 p-4 opacity-10">
                                            <Star size={100} />
                                        </div>
                                        <div className="relative z-10">
                                            <p className="text-gray-400 text-sm font-semibold mb-1 uppercase tracking-wider">{customerData?.tier || 'Bronze'} Member</p>
                                            <div className="flex items-end gap-2 mb-4">
                                                <span className="text-4xl font-black leading-none text-brand-400">{customerData?.points_balance || 0}</span>
                                                <span className="text-gray-400 text-sm font-semibold pb-1">pts</span>
                                            </div>
                                            <div className="w-full bg-gray-700 h-2 rounded-full overflow-hidden">
                                                <div className="bg-brand-500 h-full" style={{ width: `${Math.min(100, ((customerData?.points_balance || 0) / 1000) * 100)}%` }} />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <h4 className="text-sm font-bold text-gray-900 mb-3 px-1">Account Options</h4>
                                        <button className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm text-gray-600">
                                                    <History size={16} />
                                                </div>
                                                <span className="font-bold text-gray-700">Order History</span>
                                            </div>
                                            <ChevronRight size={18} className="text-gray-400" />
                                        </button>
                                        <button className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm text-gray-600">
                                                    <UserCircle size={16} />
                                                </div>
                                                <span className="font-bold text-gray-700">Edit Profile</span>
                                            </div>
                                            <ChevronRight size={18} className="text-gray-400" />
                                        </button>
                                    </div>

                                    <button 
                                        onClick={async () => {
                                            await supabase.auth.signOut()
                                            setIsLoggedIn(false)
                                            setCustomerData(null)
                                            toast.success('Signed out')
                                        }}
                                        className="w-full flex items-center justify-center gap-2 py-4 text-sm font-bold text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                                    >
                                        <LogOut size={16} />
                                        Sign Out
                                    </button>
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    )
}
