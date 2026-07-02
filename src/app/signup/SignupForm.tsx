'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { signupRestaurant } from './actions'
import { Eye, EyeOff, Camera, MapPin, ChevronLeft, ArrowRight, Check, Lock } from 'lucide-react'

type Step = 1 | 2 | 3

export default function SignupForm() {
    const router = useRouter()
    const [step, setStep] = useState<Step>(1)
    const [isPending, setIsPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const [formData, setFormData] = useState({
        restaurantName: '',
        slogan: '',
        restaurantSlug: '',
        address: '',
        contactPhone: '',
        telephone: '',
        restaurantEmail: '',
        ownerFullName: '',
        ownerEmail: '',
        ownerPassword: '',
        confirmPassword: '',
    })

    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)

    const handleNext = () => {
        setError(null)
        if (step === 1) {
            if (!formData.restaurantName || !formData.restaurantSlug || !formData.address || !formData.contactPhone) {
                setError('Please fill in all required fields.')
                return
            }
            setStep(2)
        } else if (step === 2) {
            if (!formData.ownerFullName || !formData.ownerEmail || !formData.ownerPassword || !formData.confirmPassword) {
                setError('Please fill in all required fields.')
                return
            }
            if (formData.ownerPassword !== formData.confirmPassword) {
                setError('Passwords do not match.')
                return
            }
            setStep(3)
        }
    }

    const handleBack = () => {
        setError(null)
        if (step > 1) setStep((step - 1) as Step)
    }

    const handleSubmit = async () => {
        setIsPending(true)
        setError(null)
        try {
            const result = await signupRestaurant({
                ...formData,
                subscriptionTier: 'free', // Default as per requirements
                vatRegistered: false,
            })
            if (result.error) {
                setError(result.error)
                if (result.field === 'ownerEmail') setStep(2)
                else if (result.field === 'restaurantSlug') setStep(1)
            } else {
                router.push('/admin/dashboard')
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred')
        } finally {
            setIsPending(false)
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target
        setFormData(prev => ({ ...prev, [name]: value }))
    }

    const inputClasses = "h-[50px] w-full px-4 border border-gray-200 rounded-[14px] text-[15px] focus:outline-none focus:ring-1 focus:ring-[#ff5a00] focus:border-[#ff5a00] transition-all bg-white placeholder:text-gray-400"
    const labelClasses = "text-[13px] font-semibold text-gray-900 flex gap-1 mb-1.5"
    
    return (
        <div className="flex flex-col items-center justify-start w-full max-w-[460px] mx-auto pb-10">
            {/* Mobile Sheet Handle */}
            <div className="w-12 h-1.5 rounded-full bg-[#ff6b00] mb-6 md:hidden shrink-0" />

            {/* Header Content */}
            <div className="w-full text-left mb-6 sticky top-0 bg-white z-20 pt-2 pb-4 shadow-[0_10px_10px_-10px_rgba(0,0,0,0.05)] md:pt-4">
                <div className="text-[#ff5a00] text-[13px] font-bold mb-1 tracking-wide uppercase">
                    Step {step} of 3
                </div>
                <h1 className="text-[1.75rem] font-bold text-gray-900 mb-2">
                    {step === 1 && 'Restaurant Details'}
                    {step === 2 && 'Owner Account'}
                    {step === 3 && 'Review & Create'}
                </h1>
                <p className="text-[14px] text-gray-500 font-normal">
                    {step === 1 && "Let's start with some basic information about your restaurant."}
                    {step === 2 && "Create your personal account to manage your restaurant."}
                    {step === 3 && "Review your details and create your restaurant account."}
                </p>
            </div>

            {error && (
                <div className="w-full bg-red-50 text-red-700 px-4 py-3 rounded-[14px] text-[14px] border border-red-100 font-medium mb-6 text-center">
                    {error}
                </div>
            )}

            {/* Step 1: Restaurant Details */}
            {step === 1 && (
                <div className="w-full flex flex-col gap-5 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                        <label className={labelClasses}>Restaurant Logo <span className="text-gray-400 font-normal">(optional)</span></label>
                        <div className="flex items-center gap-4">
                            <div className="w-20 h-20 rounded-[16px] border border-dashed border-gray-300 bg-gray-50 flex flex-col items-center justify-center text-gray-400 shrink-0">
                                <Camera size={24} />
                            </div>
                            <div className="flex flex-col items-start gap-2">
                                <button type="button" className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-[13px] font-semibold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm">
                                    Upload Logo
                                </button>
                                <span className="text-[11px] text-gray-400">JPG, PNG · Max 2 MB · Can be changed in Settings</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className={labelClasses}>Restaurant Name <span className="text-red-500">*</span></label>
                            <input name="restaurantName" value={formData.restaurantName} onChange={handleChange} placeholder="e.g. Himalayan Kitchen" className={inputClasses} />
                        </div>
                        <div className="flex-1">
                            <label className={labelClasses}>Slogan <span className="text-gray-400 font-normal">(optional)</span></label>
                            <input name="slogan" value={formData.slogan} onChange={handleChange} placeholder="Taste of Himalayas" className={inputClasses} />
                        </div>
                    </div>

                    <div>
                        <label className={labelClasses}>URL Slug <span className="text-red-500">*</span></label>
                        <div className="flex rounded-[14px] overflow-hidden border border-gray-200 focus-within:ring-1 focus-within:ring-[#ff5a00] focus-within:border-[#ff5a00] transition-all bg-white">
                            <div className="bg-gray-50 px-3 flex items-center justify-center border-r border-gray-200 text-gray-500 text-[14px]">
                                kkkhane.com/t/
                            </div>
                            <input name="restaurantSlug" value={formData.restaurantSlug} onChange={handleChange} placeholder="himalayan-kitchen" className="flex-1 h-[50px] px-3 outline-none text-[15px] placeholder:text-gray-400" />
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1.5">URL your customers will scan on QR codes</p>
                    </div>

                    <div>
                        <label className={labelClasses}>Address <span className="text-red-500">*</span></label>
                        <div className="flex flex-col gap-3">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input name="address" value={formData.address} onChange={handleChange} placeholder="Search Location" className={`${inputClasses} pl-10`} />
                                </div>
                                <button type="button" className="w-[50px] h-[50px] shrink-0 border border-gray-200 rounded-[14px] bg-white flex items-center justify-center text-gray-600 hover:bg-gray-50 transition-colors shadow-sm text-[#ff5a00]">
                                    <MapPin size={20} />
                                </button>
                            </div>
                            
                            {/* Premium Map Preview */}
                            <div className="w-full h-[180px] rounded-[14px] overflow-hidden border border-gray-200 relative shadow-inner group">
                                <iframe 
                                    src="https://maps.google.com/maps?q=Kathmandu,+Nepal&t=&z=13&ie=UTF8&iwloc=&output=embed" 
                                    width="100%" 
                                    height="100%" 
                                    style={{ border: 0 }} 
                                    allowFullScreen 
                                    loading="lazy" 
                                    referrerPolicy="no-referrer-when-downgrade"
                                    className="filter grayscale-[0.8] contrast-[1.1] group-hover:grayscale-0 transition-all duration-700"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-gray-900/60 via-transparent to-transparent pointer-events-none flex flex-col justify-end p-4">
                                    <div className="flex items-center gap-1.5 text-white font-bold text-[10px] uppercase tracking-wider">
                                        <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse shadow-[0_0_10px_rgba(74,222,128,0.8)]" /> 
                                        Map Preview
                                    </div>
                                    <p className="text-white/80 text-[11px] font-medium mt-0.5">Drag map to pin your exact location</p>
                                </div>
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pb-6 pointer-events-none">
                                    {/* Custom 3D Marker */}
                                    <div className="relative group-hover:-translate-y-2 transition-transform duration-300">
                                        <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center shadow-[0_8px_16px_rgba(0,0,0,0.2)]">
                                            <div className="w-6 h-6 rounded-full bg-[#ff5a00] border-2 border-white flex items-center justify-center text-white shadow-sm">
                                                <MapPin size={12} />
                                            </div>
                                        </div>
                                        <div className="w-4 h-1 bg-black/40 rounded-[100%] blur-[2px] absolute -bottom-1 left-1/2 -translate-x-1/2 group-hover:scale-50 group-hover:opacity-50 transition-all duration-300" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1">
                            <label className={labelClasses}>Mobile Number <span className="text-red-500">*</span></label>
                            <input name="contactPhone" value={formData.contactPhone} onChange={handleChange} placeholder="+977 98XXXXXXX" className={inputClasses} />
                        </div>
                        <div className="flex-1">
                            <label className={labelClasses}>Telephone <span className="text-gray-400 font-normal">(optional)</span></label>
                            <input name="telephone" value={formData.telephone} onChange={handleChange} placeholder="01-XXXXXXX" className={inputClasses} />
                        </div>
                    </div>

                    <div>
                        <label className={labelClasses}>Restaurant Email <span className="text-gray-400 font-normal">(optional)</span></label>
                        <input name="restaurantEmail" value={formData.restaurantEmail} onChange={handleChange} type="email" placeholder="info@himalayankitchen.com" className={inputClasses} />
                    </div>

                    <button type="button" onClick={handleNext} className="w-full bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 mt-2">
                        Next <ArrowRight size={18} />
                    </button>

                    <div className="w-full flex items-center gap-4 mt-2 mb-2">
                        <div className="h-px bg-gray-200 flex-1"></div>
                        <span className="text-[13px] text-gray-400 font-medium">or</span>
                        <div className="h-px bg-gray-200 flex-1"></div>
                    </div>

                    <button type="button" className="w-full bg-white border border-gray-200 text-gray-700 h-[52px] rounded-[14px] text-[15px] font-semibold shadow-sm hover:bg-gray-50 transition-all flex items-center justify-center gap-3">
                        <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
                            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Sign up with Google
                    </button>

                    <p className="text-center text-[15px] text-gray-500 mt-2">
                        Already have an account?{' '}
                        <Link href="/login" className="font-semibold text-[#ff5a00] hover:underline">
                            Log In
                        </Link>
                    </p>

                    <div className="text-center mt-1 text-[12px] text-gray-400 flex items-center justify-center gap-1.5 font-medium">
                        <Lock size={12} /> Secure & safe. Your data is protected.
                    </div>
                </div>
            )}

            {/* Step 2: Owner Account */}
            {step === 2 && (
                <div className="w-full flex flex-col gap-5 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                        <label className={labelClasses}>Full Name <span className="text-red-500">*</span></label>
                        <input name="ownerFullName" value={formData.ownerFullName} onChange={handleChange} placeholder="Enter your full name" className={inputClasses} />
                    </div>

                    <div>
                        <label className={labelClasses}>Email Address <span className="text-red-500">*</span></label>
                        <input name="ownerEmail" value={formData.ownerEmail} onChange={handleChange} type="email" placeholder="owner@restaurant.com" className={inputClasses} />
                    </div>

                    <div>
                        <label className={labelClasses}>Password <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <input name="ownerPassword" value={formData.ownerPassword} onChange={handleChange} type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" className={inputClasses} />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        {formData.ownerPassword && (
                            <div className="mt-2.5 flex items-center gap-2">
                                {[1, 2, 3, 4].map(level => {
                                    const strength = (formData.ownerPassword.length >= 8 ? 1 : 0) + (/[a-z]/.test(formData.ownerPassword) && /[A-Z]/.test(formData.ownerPassword) ? 1 : 0) + (/\d/.test(formData.ownerPassword) ? 1 : 0) + (/[^a-zA-Z\d]/.test(formData.ownerPassword) ? 1 : 0)
                                    return (
                                        <div key={level} className={`h-1.5 flex-1 rounded-full transition-colors ${strength >= level ? (strength <= 2 ? 'bg-orange-500' : strength === 3 ? 'bg-yellow-500' : 'bg-green-500') : 'bg-gray-200'}`} />
                                    )
                                })}
                                <span className="text-[11px] text-gray-500 font-medium w-12 text-right">
                                    {formData.ownerPassword.length === 0 ? '' : (() => {
                                        const strength = (formData.ownerPassword.length >= 8 ? 1 : 0) + (/[a-z]/.test(formData.ownerPassword) && /[A-Z]/.test(formData.ownerPassword) ? 1 : 0) + (/\d/.test(formData.ownerPassword) ? 1 : 0) + (/[^a-zA-Z\d]/.test(formData.ownerPassword) ? 1 : 0)
                                        return ['Weak', 'Weak', 'Fair', 'Good', 'Strong'][strength]
                                    })()}
                                </span>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className={labelClasses}>Confirm Password <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <input name="confirmPassword" value={formData.confirmPassword} onChange={handleChange} type={showConfirmPassword ? 'text' : 'password'} placeholder="Re-enter your password" className={`${inputClasses} ${formData.confirmPassword && formData.ownerPassword !== formData.confirmPassword ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''}`} />
                            <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                                {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                        {formData.confirmPassword && formData.ownerPassword !== formData.confirmPassword && (
                            <p className="text-[11px] text-red-500 mt-1.5 font-medium">Passwords do not match</p>
                        )}
                    </div>

                    <div className="flex gap-3 mt-2">
                        <button type="button" onClick={handleBack} className="w-[120px] h-[52px] rounded-[14px] border border-gray-200 bg-white text-gray-700 font-semibold text-[15px] flex items-center justify-center gap-1 hover:bg-gray-50 transition-colors shadow-sm">
                            <ChevronLeft size={18} /> Back
                        </button>
                        <button type="button" onClick={handleNext} className="flex-1 bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2">
                            Next <ArrowRight size={18} />
                        </button>
                    </div>
                    <div className="text-center mt-3 text-[12px] text-gray-400 flex items-center justify-center gap-1.5 font-medium">
                        <Lock size={12} /> Secure & safe. Your data is protected.
                    </div>
                </div>
            )}

            {/* Step 3: Review & Create */}
            {step === 3 && (
                <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div className="border border-gray-100 rounded-[16px] overflow-hidden shadow-sm">
                        <div className="bg-white divide-y divide-gray-100">
                            {[
                                { label: 'Restaurant Name', value: formData.restaurantName },
                                { label: 'Slogan', value: formData.slogan || '-' },
                                { label: 'URL', value: `kkkhane.com/t/${formData.restaurantSlug}` },
                                { label: 'Address', value: formData.address },
                                { label: 'Mobile', value: formData.contactPhone },
                                { label: 'Telephone', value: formData.telephone || '-' },
                                { label: 'Email', value: formData.restaurantEmail || '-' },
                                { label: 'Owner Name', value: formData.ownerFullName },
                                { label: 'Login Email', value: formData.ownerEmail },
                            ].map((item, i) => (
                                <div key={i} className="flex items-center px-4 py-3 text-[13px]">
                                    <div className="w-[130px] text-gray-500">{item.label}</div>
                                    <div className="flex-1 text-right text-gray-900 font-medium">{item.value}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <p className="text-center text-[11px] text-gray-500 px-4 leading-relaxed">
                        By creating an account you agree to our <br/>
                        <span className="text-[#ff5a00] font-semibold cursor-pointer hover:underline">Terms of Service</span> and <span className="text-[#ff5a00] font-semibold cursor-pointer hover:underline">Privacy Policy</span>.
                    </p>

                    <div className="flex gap-3">
                        <button type="button" onClick={handleBack} className="w-[120px] h-[52px] rounded-[14px] border border-gray-200 bg-white text-gray-700 font-semibold text-[15px] flex items-center justify-center gap-1 hover:bg-gray-50 transition-colors shadow-sm" disabled={isPending}>
                            <ChevronLeft size={18} /> Back
                        </button>
                        <button type="button" onClick={handleSubmit} disabled={isPending} className="flex-1 bg-[#ff5a00] hover:bg-[#ff4500] text-white h-[52px] rounded-[14px] text-[16px] font-semibold shadow-lg shadow-[#ff5a00]/25 transition-all hover:scale-[1.01] flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                            {isPending ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <>Sign Up <Check size={18} /></>
                            )}
                        </button>
                    </div>
                    <div className="text-center text-[12px] text-gray-400 flex items-center justify-center gap-1.5 font-medium">
                        <Lock size={12} /> Secure & safe. Your data is protected.
                    </div>
                </div>
            )}
        </div>
    )
}
