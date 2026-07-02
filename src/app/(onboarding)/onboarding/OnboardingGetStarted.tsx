'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Store, MoreHorizontal, Settings, Moon, Bell, Share2, LogOut, MessageSquareText, ChevronLeft } from 'lucide-react'
import { signOutAndRedirect } from '@/lib/auth/signOut'

export default function OnboardingGetStarted({
    userEmail = 'user@example.com',
    userName = 'User',
    userId = ''
}: {
    userEmail?: string
    userName?: string
    userId?: string
}) {
    const router = useRouter()
    const [isMenuOpen, setIsMenuOpen] = useState(false)

    const handleContinue = () => {
        router.push('/onboarding/create')
    }

    const handleLogout = () => signOutAndRedirect(router)

    const initials = userName.substring(0, 2).toUpperCase()

    return (
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
            
            <button onClick={() => router.push('/login')} className="mb-6 flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
                <ChevronLeft size={16} />
            </button>

            <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Get Started</h1>
            <p className="text-gray-500 font-medium mb-8">Tell us your name and how you'll be using kkkhane</p>

            {/* Profile Block */}
            <div className="mb-8">
                <h3 className="text-sm font-bold text-gray-900 mb-3">Your Profile</h3>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 flex items-center justify-between relative">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-700 font-black flex items-center justify-center text-lg uppercase tracking-wider">
                            {initials}
                        </div>
                        <div>
                            <h4 className="font-bold text-gray-900 leading-tight">{userName}</h4>
                            <p className="text-xs text-gray-500">{userEmail}</p>
                        </div>
                    </div>

                    <button 
                        onClick={() => setIsMenuOpen(!isMenuOpen)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-200 transition-colors text-gray-500"
                    >
                        <MoreHorizontal size={20} />
                    </button>

                    {/* Dropdown Menu */}
                    {isMenuOpen && (
                        <div className="absolute top-full right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-20 animate-in fade-in zoom-in-95 duration-200">
                            <div className="p-3 border-b border-gray-100 mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 font-black flex items-center justify-center">
                                        {initials}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm text-gray-900">{userName}</h4>
                                        <p className="text-[10px] text-gray-500 truncate w-32">{userEmail}</p>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="space-y-1">
                                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <Settings size={16} className="text-gray-400" /> Profile Setting
                                </button>
                                <button className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <div className="flex items-center gap-3">
                                        <Moon size={16} className="text-gray-400" /> Dark Theme
                                    </div>
                                    <div className="w-8 h-4 bg-gray-200 rounded-full relative">
                                        <div className="w-4 h-4 bg-white rounded-full shadow absolute left-0 top-0"></div>
                                    </div>
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <MessageSquareText size={16} className="text-gray-400" /> Invitation
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <Share2 size={16} className="text-gray-400" /> Share Profile
                                </button>
                                <button className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <Bell size={16} className="text-gray-400" /> User Notification Preferences
                                </button>
                            </div>

                            <div className="mt-2 pt-2 border-t border-gray-100">
                                <button 
                                    onClick={handleLogout}
                                    className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-bold text-gray-900 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
                                >
                                    <LogOut size={16} /> Log out
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* What's next */}
            <div className="mb-8">
                <div className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-[var(--color-primary)] bg-brand-50">
                    <Store size={20} className="text-[var(--color-primary)]" />
                    <span className="font-bold text-sm text-gray-900">
                        Next, you&apos;ll set up your restaurant
                    </span>
                </div>
            </div>

            <button 
                onClick={handleContinue}
                className="w-full bg-[var(--color-primary)] text-white font-bold py-4 rounded-full hover:scale-[1.02] transition-transform shadow-lg shadow-[var(--color-primary)]/20"
            >
                Continue
            </button>
        </div>
    )
}
