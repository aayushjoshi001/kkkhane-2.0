'use client'

import { useState, useRef } from 'react'
import { updateProfile } from '@/app/(admin)/admin/profile/actions'
import { User } from '@/types/database'
import { Save, Loader2, Camera, X } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ProfileForm({ user }: { user: User }) {
    const [isSaving, setIsSaving] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [avatarUrl, setAvatarUrl] = useState<string>(user.avatar_url || '')
    const [fullName, setFullName] = useState(user.full_name)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const roleLabel = (user.roles?.name || 'admin').replace(/_/g, ' ')
    const fallbackAvatar = `https://api.dicebear.com/9.x/notionists/svg?seed=${roleLabel}&backgroundColor=ff5a00`
    
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
        } catch {
            toast.error('Something went wrong')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="bg-surface border border-hairline rounded-[var(--r-xl)] shadow-sm overflow-hidden">
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
                                <img src={displayAvatar} alt="Profile avatar" className="w-full h-full object-cover" />
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
                <div className="space-y-5">
                    <div>
                        <label className="block text-sm font-bold text-ink mb-2">Full Name</label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={e => setFullName(e.target.value)}
                            required
                            placeholder="John Doe"
                            className="w-full h-11 px-4 bg-surface-muted border border-hairline rounded-[var(--r-md)] focus-ring text-ink placeholder:text-ink-muted transition-colors font-medium"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-ink mb-2">Role</label>
                        <input
                            type="text"
                            value={roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}
                            disabled
                            className="w-full h-11 px-4 bg-surface-muted/50 border border-hairline rounded-[var(--r-md)] text-ink-subtle font-bold cursor-not-allowed uppercase text-xs tracking-wider"
                        />
                        <p className="text-xs text-ink-muted mt-2">Your role determines your access level. Only Super Admins can change roles.</p>
                    </div>
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
