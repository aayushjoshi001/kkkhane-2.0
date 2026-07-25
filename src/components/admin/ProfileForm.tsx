'use client'

import { useState, useRef } from 'react'
import Image from 'next/image'
import { updateProfile } from '@/lib/actions/profile'
import { createClient } from '@/lib/supabase/client'
import { generatedAvatar, isGeneratedAvatar } from '@/lib/avatar'
import { Save, Loader2, Camera, X, Shield, Mail, Calendar, Hash, Key, User as UserIcon } from 'lucide-react'
import toast from 'react-hot-toast'
import type { User } from '@/types/database'

type ProfileUser = User & {
    roles?: { name: string } | null;
    departments?: { name: string } | null;
}

export default function ProfileForm({ user, email, backupPassword = '' }: { user: ProfileUser, email: string, backupPassword?: string }) {
    const [isSaving, setIsSaving] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [avatarUrl, setAvatarUrl] = useState<string>(user.avatar_url || '')
    const [fullName, setFullName] = useState(user.full_name)
    const [resettingPassword, setResettingPassword] = useState(false)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const roleLabel = (user.roles?.name || 'admin').replace(/_/g, ' ')
    const fallbackAvatar = generatedAvatar(roleLabel)
    
    // Fallback UI to show placeholder if no avatar set, or loading state
    const displayAvatar = avatarUrl || fallbackAvatar

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
            toast.success('Avatar uploaded successfully! Click Save to apply.')
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'An error occurred')
        } finally {
            setIsUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!fullName.trim()) {
            toast.error('Full name is required')
            return
        }

        setIsSaving(true)
        try {
            const formData = new FormData()
            formData.append('full_name', fullName)
            formData.append('avatar_url', avatarUrl)

            const res = await updateProfile(formData)
            
            if (res.error) {
                toast.error(res.error)
            } else {
                toast.success('Profile updated successfully')
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to update profile')
        } finally {
            setIsSaving(false)
        }
    }

    const handleResetPassword = async () => {
        setResettingPassword(true)
        const supabase = createClient()
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}/admin/reset-password`,
        })
        if (error) {
            toast.error('Failed to send password reset email')
        } else {
            toast.success('Password reset email sent!')
        }
        setResettingPassword(false)
    }

    return (
        <form onSubmit={handleSubmit} className="bg-surface rounded-card shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-hairline overflow-hidden w-full">
            <div className="p-6 md:p-8 space-y-8">
                
                {/* Avatar Section */}
                <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
                    <div className="relative group shrink-0">
                        <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-hairline bg-surface-muted relative shadow-inner">
                            {isUploading ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                    <Loader2 size={24} className="animate-spin text-ink-subtle" />
                                </div>
                            ) : (
                                <Image src={displayAvatar} alt="Profile avatar" fill sizes="96px" unoptimized={isGeneratedAvatar(displayAvatar)} className="object-cover" />
                            )}
                        </div>
                        
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="absolute -bottom-2 -right-2 w-10 h-10 bg-brand-500 text-white rounded-full flex items-center justify-center hover:bg-brand-600 transition-colors shadow-md border-2 border-surface disabled:opacity-50"
                            aria-label="Upload new avatar"
                        >
                            <Camera size={16} />
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            className="hidden"
                        />
                    </div>
                    
                    <div>
                        <h3 className="text-h3 font-extrabold text-ink mb-1">Profile Picture</h3>
                        <p className="text-ink-subtle text-sm mb-3">Upload a new avatar. Max file size is 5MB.</p>
                        {avatarUrl && (
                            <button
                                type="button"
                                onClick={() => setAvatarUrl('')}
                                className="text-sm font-bold text-danger-fg hover:text-danger-fg/80 transition-colors flex items-center gap-1.5"
                            >
                                <X size={14} /> Remove Avatar
                            </button>
                        )}
                    </div>
                </div>

                <hr className="border-hairline" />

                {/* Info Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5"><UserIcon size={14} className="text-ink-subtle"/> Full Name <span className="text-brand-500">*</span></label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            required
                            placeholder="John Doe"
                            className="w-full h-11 px-4 bg-surface-muted border border-hairline rounded-[var(--r-md)] focus-ring text-ink placeholder:text-ink-muted transition-colors font-medium"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5"><Mail size={14} className="text-ink-subtle"/> Email Address</label>
                        <input
                            type="email"
                            value={email}
                            disabled
                            className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] text-ink-subtle font-bold cursor-not-allowed text-sm"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5"><Shield size={14} className="text-ink-subtle"/> Role</label>
                        <div className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] flex items-center">
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-brand-50 text-brand-700 border border-brand-100">
                                {roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5"><Hash size={14} className="text-ink-subtle"/> System ID</label>
                        <input
                            type="text"
                            value={user.id}
                            disabled
                            className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] text-ink-subtle font-mono font-bold cursor-not-allowed text-xs"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="block text-sm font-bold text-ink">Account Status</label>
                        <div className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] flex items-center gap-2 text-sm font-bold cursor-not-allowed">
                            {user.is_active ? (
                                <><span className="w-2 h-2 rounded-full bg-emerald-500" /> <span className="text-emerald-700">Active</span></>
                            ) : (
                                <><span className="w-2 h-2 rounded-full bg-rose-500" /> <span className="text-rose-700">Suspended</span></>
                            )}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5">Department</label>
                        <input
                            type="text"
                            value={user.departments?.name || 'Unassigned'}
                            disabled
                            className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] text-ink-subtle font-bold cursor-not-allowed text-sm"
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-bold text-ink flex items-center gap-1.5"><Calendar size={14} className="text-ink-subtle"/> Member Since</label>
                        <input
                            type="text"
                            value={new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                            disabled
                            className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] text-ink-subtle font-bold cursor-not-allowed text-sm"
                        />
                    </div>
                </div>

                <hr className="border-hairline" />

                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h4 className="text-sm font-bold text-ink flex items-center gap-1.5"><Key size={14} className="text-ink-subtle"/> Security</h4>
                        <p className="text-xs text-ink-muted mt-1">Need to change your password? We will email you a secure reset link.</p>
                    </div>
                    <button
                        type="button"
                        onClick={handleResetPassword}
                        disabled={resettingPassword}
                        className="px-4 py-2 text-sm font-bold text-ink hover:text-brand-600 bg-surface border border-hairline rounded-[var(--r-md)] hover:bg-brand-50 transition-colors focus-ring disabled:opacity-50 flex items-center gap-2"
                    >
                        {resettingPassword ? <Loader2 size={14} className="animate-spin" /> : null}
                        Reset Password
                    </button>
                </div>

                {backupPassword && (
                    <>
                        <hr className="border-hairline" />
                        <div className="flex items-center justify-between gap-4 flex-wrap bg-surface-muted/30 p-5 rounded-2xl border border-hairline">
                            <div>
                                <h4 className="text-sm font-extrabold text-ink flex items-center gap-1.5">
                                    <Key size={14} className="text-ink-subtle"/> Hotel Data Backup Password
                                </h4>
                                <p className="text-xs text-ink-subtle mt-1">
                                    Use this password to decrypt your password-protected ZIP exports.
                                </p>
                            </div>
                            <div className="bg-surface border border-hairline px-4 py-2.5 rounded-xl select-all font-mono font-extrabold text-brand-600 tracking-wider text-xs shadow-sm">
                                {backupPassword}
                            </div>
                        </div>
                    </>
                )}

                <div className="text-xs text-ink-muted">
                    <p>Contact your Super Admin if you need to change your email, role, or department.</p>
                </div>

            </div>
            
            <div className="px-6 py-4 bg-surface-muted/30 border-t border-hairline flex justify-end">
                <button
                    type="submit"
                    disabled={isSaving || isUploading}
                    className="h-11 px-6 bg-brand-500 text-white font-bold rounded-[var(--r-md)] hover:bg-brand-600 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-70 focus-ring"
                >
                    {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {isSaving ? 'Saving...' : 'Save Profile'}
                </button>
            </div>
        </form>
    )
}
