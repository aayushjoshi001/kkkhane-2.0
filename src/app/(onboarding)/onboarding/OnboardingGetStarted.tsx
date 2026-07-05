'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Store, MoreHorizontal, Settings, LogOut, ChevronLeft, Camera, X, Loader2, Check } from 'lucide-react'
import { signOutAndRedirect } from '@/lib/auth/signOut'
import { updateOnboardingProfile } from './actions'
import { toast } from 'react-hot-toast'

export default function OnboardingGetStarted({
    userEmail = 'user@example.com',
    userName = 'User',
    userId = '',
    userAvatarUrl = null,
}: {
    userEmail?: string
    userName?: string
    userId?: string
    userAvatarUrl?: string | null
}) {
    const router = useRouter()
    const [isMenuOpen, setIsMenuOpen] = useState(false)
    const [isProfileModalOpen, setIsProfileModalOpen] = useState(false)

    const [fullName, setFullName] = useState(userName)
    const [avatarUrl, setAvatarUrl] = useState(userAvatarUrl || '')
    const [isUploading, setIsUploading] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleContinue = () => {
        router.push('/onboarding/create')
    }

    const handleLogout = () => signOutAndRedirect(router)

    const initials = userName.substring(0, 2).toUpperCase()

    const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setIsUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('type', 'image')
            formData.append('folder', 'avatars')

            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const data = await res.json()

            if (!res.ok) throw new Error(data.error || 'Failed to upload image')

            setAvatarUrl(data.url)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setIsUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const handleSaveProfile = async () => {
        if (!fullName.trim()) {
            toast.error('Full name is required')
            return
        }

        setIsSaving(true)
        try {
            const formData = new FormData()
            formData.append('full_name', fullName)
            formData.append('avatar_url', avatarUrl)

            const res = await updateOnboardingProfile(formData)

            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Profile updated')
                setIsProfileModalOpen(false)
                router.refresh()
            }
        } catch {
            toast.error('Something went wrong')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 sm:p-10 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">

            <button onClick={() => router.push('/login')} className="mb-6 flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
                <ChevronLeft size={16} />
            </button>

            <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Get Started</h1>
            <p className="text-gray-500 font-medium mb-8">Tell us your name and how you'll be using KKKhane</p>

            {/* Profile Block */}
            <div className="mb-8">
                <h3 className="text-sm font-bold text-gray-900 mb-3">Your Profile</h3>
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 flex items-center justify-between relative">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-brand-50 text-brand-700 font-black flex items-center justify-center text-lg uppercase tracking-wider overflow-hidden">
                            {avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={avatarUrl} alt={userName} className="w-full h-full object-cover" />
                            ) : initials}
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
                                    <div className="w-10 h-10 rounded-lg bg-brand-50 text-brand-700 font-black flex items-center justify-center overflow-hidden">
                                        {avatarUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={avatarUrl} alt={userName} className="w-full h-full object-cover" />
                                        ) : initials}
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm text-gray-900">{userName}</h4>
                                        <p className="text-[10px] text-gray-500 truncate w-32">{userEmail}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <button onClick={() => { setIsProfileModalOpen(true); setIsMenuOpen(false) }} className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl transition-colors">
                                    <Settings size={16} className="text-gray-400" /> Profile Setting
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

            {/* Profile Setting Modal */}
            {isProfileModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
                    <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden">
                        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                            <h3 className="font-extrabold text-gray-900 text-lg">Profile Setting</h3>
                            <button onClick={() => setIsProfileModalOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="p-6 space-y-6">
                            <div className="flex flex-col items-center gap-3">
                                <div className="relative group">
                                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-gray-100 bg-gray-50 relative shadow-inner flex items-center justify-center">
                                        {isUploading ? (
                                            <Loader2 size={22} className="animate-spin text-gray-400" />
                                        ) : avatarUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={avatarUrl} alt="Profile avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-xl font-black text-brand-700 uppercase">{initials}</span>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={isUploading}
                                        className="absolute -bottom-1 -right-1 w-8 h-8 bg-[var(--color-primary)] text-white rounded-full flex items-center justify-center shadow-md border-2 border-white disabled:opacity-50"
                                        aria-label="Upload new avatar"
                                    >
                                        <Camera size={14} />
                                    </button>
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleAvatarFileChange}
                                        accept="image/jpeg,image/png,image/webp,image/gif"
                                        className="hidden"
                                    />
                                </div>
                                {avatarUrl && (
                                    <button type="button" onClick={() => setAvatarUrl('')} className="text-xs font-bold text-red-500 hover:text-red-600 transition-colors flex items-center gap-1">
                                        <X size={12} /> Remove Avatar
                                    </button>
                                )}
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Full Name</label>
                                <input
                                    type="text"
                                    value={fullName}
                                    onChange={(e) => setFullName(e.target.value)}
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-900 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20 focus:border-[var(--color-primary)] transition-all"
                                />
                            </div>
                        </div>

                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
                            <button
                                onClick={() => setIsProfileModalOpen(false)}
                                disabled={isSaving}
                                className="px-4 py-2.5 text-sm font-bold text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveProfile}
                                disabled={isSaving || isUploading}
                                className="px-5 py-2.5 text-sm font-bold text-white bg-[var(--color-primary)] rounded-xl shadow-md hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
