'use client'

import { useState, useEffect } from 'react'
import { useConfirmStore } from '@/lib/stores/confirm'
import Image from 'next/image'
import { HomepageConfig, HomepageTemplate, HOMEPAGE_TEMPLATES } from '@/types/database'
import { 
    Monitor, Tablet, Smartphone, Save, ImageIcon,
    MapPin, Megaphone, Palette,
    MenuIcon, Globe, Layout, Sparkles, 
    ChevronDown, X, Plus, 
    ArrowLeft, Trash2, Eye, Upload, Loader2, AlertCircle
} from 'lucide-react'
import { toast } from 'react-hot-toast'
import { uploadMedia } from '@/lib/uploadMedia'
import HomepageRenderer from '@/components/customer/homepage/HomepageRenderer'
import { useHomepageConfig } from '@/lib/hooks/useHomepageConfig'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

interface HomepageManagerProps {
    restaurantId: string
}

const DEFAULT_CONFIG: HomepageConfig = {
    restaurant_id: '',
    template: 'modern',
    hero_title: 'Welcome to Our Restaurant',
    hero_subtitle: 'Experience authentic flavors',
    hero_image_url: null,
    hero_video_url: null,
    hero_cta_text: 'View Menu',
    theme_primary: '#FB6303',
    theme_secondary: '#1B263B',
    theme_accent: '#EC4899',
    logo_url: null,
    about: { enabled: true, title: 'About Us', description: 'Tell your story here', image_url: '' },
    features: [
        { title: 'Fresh Ingredients', description: 'Sourced daily' },
        { title: 'Expert Chefs', description: 'Years of experience' },
        { title: '24/7 Service', description: 'Always available' },
    ],
    cta: { enabled: true, headline: 'Order Now', description: 'Get your favorite meal delivered', button_text: 'Start Ordering' },
    gallery: [],
    social: {},
    contact: { enabled: true },
    footer: { enabled: true, copyright: `© ${new Date().getFullYear()} Your Restaurant`, social_links: [] },
}

const LEFT_SECTIONS = [
    { id: 'hero', name: 'Hero Banner', desc: 'First impression', icon: Layout },
    { id: 'about', name: 'About Us', desc: 'Your story', icon: MenuIcon },
    { id: 'features', name: 'Highlights', desc: 'Why choose us', icon: Sparkles },
    { id: 'cta', name: 'Action Banner', desc: 'Drive orders', icon: Megaphone },
    { id: 'gallery', name: 'Gallery', desc: 'Visual showcase', icon: ImageIcon },
    { id: 'contact', name: 'Location', desc: 'Map & Phone', icon: MapPin },
]

// Helper UI for text inputs
interface InputProps {
    label: string
    value: string
    onChange: (value: string) => void
    placeholder?: string
}

const Input = ({ label, value, onChange, placeholder }: InputProps) => (
    <div className="mb-4">
        <label className="block text-xs font-semibold text-ink mb-1.5">{label}</label>
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
    </div>
)

const Textarea = ({ label, value, onChange, placeholder }: InputProps) => (
    <div className="mb-4">
        <label className="block text-xs font-semibold text-ink mb-1.5">{label}</label>
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
    </div>
)

export default function HomepageManager({ restaurantId }: HomepageManagerProps) {
    const { confirm } = useConfirmStore()
    const { config: fetchedConfig, isLoading, error } = useHomepageConfig(restaurantId)
    const [config, setConfig] = useState<HomepageConfig>(DEFAULT_CONFIG)
    const [isSaving, setIsSaving] = useState(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    
    // UI State
    const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [expandedRightPanel, setExpandedRightPanel] = useState<string | null>('theme')
    const [editingSection, setEditingSection] = useState<string | null>(null)

    useEffect(() => {
        if (fetchedConfig) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConfig({ ...DEFAULT_CONFIG, ...fetchedConfig })
        } else if (fetchedConfig === null) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConfig({ ...DEFAULT_CONFIG, restaurant_id: restaurantId })
        }
    }, [fetchedConfig, restaurantId])

    const patch = (p: Partial<HomepageConfig>) => setConfig((c) => ({ ...c, ...p }))
    const patchAbout = (p: Partial<NonNullable<HomepageConfig['about']>>) =>
        setConfig((c) => ({ ...c, about: { ...DEFAULT_CONFIG.about!, ...c.about, ...p } }))
    const patchCta = (p: Partial<NonNullable<HomepageConfig['cta']>>) =>
        setConfig((c) => ({ ...c, cta: { ...DEFAULT_CONFIG.cta!, ...c.cta, ...p } }))
    const patchContact = (p: Partial<NonNullable<HomepageConfig['contact']>>) =>
        setConfig((c) => ({ ...c, contact: { ...c.contact, ...p } }))
    const patchSocial = (p: Partial<NonNullable<HomepageConfig['social']>>) =>
        setConfig((c) => ({ ...c, social: { ...c.social, ...p } }))
    const patchFooter = (p: Partial<NonNullable<HomepageConfig['footer']>>) =>
        setConfig((c) => ({ ...c, footer: { ...DEFAULT_CONFIG.footer!, ...c.footer, ...p } }))

    const uploadFile = async (file: File, type: 'image' | 'video'): Promise<string | null> => {
        const toastId = toast.loading(type === 'video' ? 'Uploading video…' : 'Uploading image…')
        const { url, error: uploadErr } = await uploadMedia(file, type, 'homepage')
        toast.dismiss(toastId)
        if (uploadErr || !url) {
            toast.error(uploadErr || 'Upload failed')
            return null
        }
        return url
    }

    const saveConfig = async (updatedConfig: HomepageConfig, silent = false) => {
        if (!silent) setIsSaving(true)
        try {
            const response = await fetch('/api/homepage/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedConfig),
            })
            const data = await response.json()
            if (!response.ok) {
                toast.error(data.error || 'Failed to save homepage')
                return
            }
            if (!silent) toast.success('Progress saved')
            setConfig({ ...DEFAULT_CONFIG, ...(data.config || updatedConfig) })
        } catch (err) {
            toast.error('Error saving homepage')
            console.error(err)
        } finally {
            if (!silent) setIsSaving(false)
        }
    }

    const save = () => saveConfig(config)
    const patchAndSave = async (p: Partial<HomepageConfig>) => {
        const next = { ...config, ...p }
        setConfig(next)
        await saveConfig(next, true)
    }

    const toggleRightPanel = (panel: string) => {
        setExpandedRightPanel(expandedRightPanel === panel ? null : panel)
    }

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-24">
                <Loader2 size={48} className="animate-spin text-brand-500 mb-6" />
                <p className="text-ink font-bold animate-pulse">Initializing Website Builder...</p>
            </div>
        )
    }

    if (error && error !== 'No homepage config found') {
        return (
            <div className="p-8 text-center bg-danger-bg rounded-card border border-danger-fg/20 max-w-lg mx-auto mt-12">
                <AlertCircle size={48} className="mx-auto mb-4 text-danger-fg" />
                <p className="text-danger-fg font-extrabold text-lg mb-2">Failed to load builder</p>
                <p className="text-danger-fg/80 text-sm mb-6">{error}</p>
                <button onClick={() => window.location.reload()} className="px-6 py-2.5 bg-danger-fg text-white font-bold rounded-lg hover:opacity-90">
                    Retry Connection
                </button>
            </div>
        )
    }

    const features = Array.isArray(config.features) ? config.features : []
    const gallery = Array.isArray(config.gallery) ? config.gallery : []

    return (
        <div className="flex flex-col h-[calc(100vh-64px)] -mx-5 md:-mx-8 -my-5 md:-my-8 bg-canvas overflow-hidden font-sans">
            {/* Builder Top Bar */}
            <div className="h-14 border-b border-hairline bg-surface flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-brand-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-sm">
                            <Globe className="w-4 h-4" />
                        </div>
                        <div>
                            <h1 className="text-sm font-semibold text-ink leading-tight">Website Builder</h1>
                            <p className="text-xs text-ink-muted leading-tight">Editing: {restaurantId}</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center bg-surface border border-hairline rounded-full p-1 gap-1 hidden lg:flex shadow-sm">
                    <button onClick={() => setDeviceMode('desktop')} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200", deviceMode === 'desktop' ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-ink-muted hover:text-ink')}>
                        <Monitor className="w-3.5 h-3.5" /> Desktop
                    </button>
                    <button onClick={() => setDeviceMode('tablet')} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200", deviceMode === 'tablet' ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-ink-muted hover:text-ink')}>
                        <Tablet className="w-3.5 h-3.5" /> Tablet
                    </button>
                    <button onClick={() => setDeviceMode('mobile')} className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200", deviceMode === 'mobile' ? 'bg-brand-50 text-brand-700 shadow-sm' : 'text-ink-muted hover:text-ink')}>
                        <Smartphone className="w-3.5 h-3.5" /> Mobile
                    </button>
                </div>

                <div className="flex items-center gap-2 md:gap-3">
                    {isSaving && (
                        <span className="hidden md:flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">
                            <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                        </span>
                    )}
                    <button onClick={() => setIsPreviewOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-surface border border-hairline hover:bg-surface-muted rounded-full transition-colors">
                        <Eye className="w-3.5 h-3.5" /> Full Preview
                    </button>
                    <button onClick={save} className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-full transition-colors shadow-sm">
                        <Save className="w-4 h-4" /> Save
                    </button>
                </div>
            </div>

            {/* Main Builder Area */}
            <div className="flex flex-1 overflow-hidden relative">
                {/* Left Sidebar */}
                <div className="w-72 bg-surface border-r border-hairline flex flex-col shrink-0 shadow-[4px_0_15px_-3px_rgba(0,0,0,0.02)] z-10">
                    {!editingSection ? (
                        <>
                            <div className="h-14 border-b border-hairline px-4 flex items-center justify-between shrink-0 bg-surface">
                                <h2 className="text-sm font-semibold text-ink">Page Layout</h2>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto scrollbar-hide">
                                {/* Active / Hidden Tabs */}
                                <div className="flex items-center border-b border-hairline bg-surface sticky top-0 z-10">
                                    <button className="flex-1 py-2.5 text-xs font-semibold text-brand-700 border-b-2 border-brand-500 bg-brand-50/30">
                                        Active
                                    </button>
                                    <button className="flex-1 py-2.5 text-xs font-medium text-ink-muted hover:text-ink transition-colors">
                                        Hidden
                                    </button>
                                </div>

                                <div className="p-3 space-y-2">
                                    {LEFT_SECTIONS.map((section) => {
                                        // Determine if section is considered "active"
                                        let isActive = true
                                        if (section.id === 'about') isActive = config.about?.enabled ?? true
                                        if (section.id === 'cta') isActive = config.cta?.enabled ?? true
                                        if (section.id === 'contact') isActive = config.contact?.enabled ?? true
                                        if (section.id === 'features') isActive = (config.features?.length ?? 0) > 0
                                        if (section.id === 'gallery') isActive = (config.gallery?.length ?? 0) > 0

                                        return (
                                            <div 
                                                key={section.id} 
                                                className="group flex items-center p-3 bg-surface border border-hairline hover:border-brand-300 rounded-lg shadow-sm hover:shadow-md transition-all"
                                            >
                                                <div className="text-ink-muted/50 cursor-grab hover:text-ink mr-2">
                                                    <MenuIcon className="w-4 h-4" />
                                                </div>
                                                <div 
                                                    className="flex-1 flex items-center gap-3 cursor-pointer"
                                                    onClick={() => setEditingSection(section.id)}
                                                >
                                                    <div className="text-ink bg-surface-muted p-1.5 rounded-md group-hover:bg-brand-50 group-hover:text-brand-600 transition-colors">
                                                        <section.icon className="w-4 h-4" />
                                                    </div>
                                                    <div>
                                                        <div className="text-sm font-semibold text-ink group-hover:text-brand-700 transition-colors leading-none">{section.name}</div>
                                                        <div className="text-[10px] text-ink-muted mt-1 leading-none">{section.desc}</div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={(e) => {
                                                        e.stopPropagation()
                                                        // Toggle logic
                                                        if (section.id === 'about') patchAbout({ enabled: !isActive })
                                                        else if (section.id === 'cta') patchCta({ enabled: !isActive })
                                                        else if (section.id === 'contact') patchContact({ enabled: !isActive })
                                                    }} className="p-1.5 text-ink-muted hover:text-brand-600 hover:bg-brand-50 rounded-md transition-colors" title={isActive ? "Hide Section" : "Show Section"}>
                                                        {isActive ? <Eye className="w-4 h-4" /> : <Eye className="w-4 h-4 opacity-50" />}
                                                    </button>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="flex flex-col h-full animate-fade-in">
                            <div className="h-14 border-b border-hairline px-4 flex items-center gap-3 shrink-0 bg-surface">
                                <button onClick={() => setEditingSection(null)} className="p-1.5 hover:bg-surface-muted rounded-md text-ink-muted hover:text-ink transition-colors">
                                    <ArrowLeft className="w-4 h-4" />
                                </button>
                                <div>
                                    <h2 className="text-sm font-semibold text-ink leading-tight">Edit Section</h2>
                                    <p className="text-xs text-ink-muted">{LEFT_SECTIONS.find(s => s.id === editingSection)?.name}</p>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {editingSection === 'hero' && (
                                    <>
                                        <Input label="Headline (H1)" value={config.hero_title || ''} onChange={(v: string) => patch({ hero_title: v })} placeholder="E.g. Authentic Italian Cuisine" />
                                        <Input label="Subtitle" value={config.hero_subtitle || ''} onChange={(v: string) => patch({ hero_subtitle: v })} placeholder="Experience the taste..." />
                                        <Input label="Button Text" value={config.hero_cta_text || ''} onChange={(v: string) => patch({ hero_cta_text: v })} placeholder="View Menu" />
                                        
                                        <div className="mt-4">
                                            <label className="block text-xs font-semibold text-ink mb-1.5">Background Image</label>
                                            {config.hero_image_url ? (
                                                <div className="relative aspect-video rounded-xl overflow-hidden border border-hairline shadow-sm mb-4">
                                                    <Image src={config.hero_image_url} alt="Hero" fill className="object-cover" />
                                                    <button onClick={() => patchAndSave({ hero_image_url: null })} className="absolute top-2 right-2 p-1.5 bg-danger-bg text-danger-fg rounded-full hover:scale-110 transition-transform"><X size={14} /></button>
                                                </div>
                                            ) : (
                                                <label className="flex flex-col items-center justify-center aspect-video border-2 border-dashed border-hairline rounded-xl cursor-pointer hover:bg-surface-muted transition-colors mb-4">
                                                    <Upload size={20} className="text-ink-muted mb-2" />
                                                    <span className="text-xs font-medium">Upload Image</span>
                                                    <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ hero_image_url: url }) } }} className="sr-only" />
                                                </label>
                                            )}

                                            <label className="block text-xs font-semibold text-ink mb-1.5">Or Background Video (Overrides Image)</label>
                                            {config.hero_video_url ? (
                                                <div className="relative aspect-video rounded-xl overflow-hidden border border-hairline shadow-sm">
                                                    <video src={config.hero_video_url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                                                    <button onClick={() => patchAndSave({ hero_video_url: null })} className="absolute top-2 right-2 p-1.5 bg-danger-bg text-danger-fg rounded-full hover:scale-110 transition-transform"><X size={14} /></button>
                                                </div>
                                            ) : (
                                                <label className="flex flex-col items-center justify-center aspect-video border-2 border-dashed border-hairline rounded-xl cursor-pointer hover:bg-surface-muted transition-colors bg-surface">
                                                    <Upload size={20} className="text-ink-muted mb-2" />
                                                    <span className="text-xs font-medium">Upload Video</span>
                                                    <input type="file" accept="video/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'video'); if (url) await patchAndSave({ hero_video_url: url }) } }} className="sr-only" />
                                                </label>
                                            )}
                                        </div>
                                    </>
                                )}

                                {editingSection === 'about' && (
                                    <>
                                        <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                            <input type="checkbox" checked={config.about?.enabled ?? true} onChange={(e) => patchAbout({ enabled: e.target.checked })} className="rounded border-hairline text-brand-500 focus:ring-brand-500" />
                                            <span className="text-sm font-medium">Enable About Section</span>
                                        </label>
                                        <div className={!config.about?.enabled ? 'opacity-50 pointer-events-none' : ''}>
                                            <Input label="Section Title" value={config.about?.title || ''} onChange={(v: string) => patchAbout({ title: v })} />
                                            <Textarea label="Our Story" value={config.about?.description || ''} onChange={(v: string) => patchAbout({ description: v })} />
                                            <div className="mt-4">
                                                <label className="block text-xs font-semibold text-ink mb-1.5">Section Image</label>
                                                {config.about?.image_url ? (
                                                    <div className="relative aspect-video rounded-xl overflow-hidden border border-hairline shadow-sm">
                                                        <Image src={config.about.image_url} alt="About" fill className="object-cover" />
                                                        <button onClick={() => patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: '' } })} className="absolute top-2 right-2 p-1.5 bg-danger-bg text-danger-fg rounded-full"><X size={14} /></button>
                                                    </div>
                                                ) : (
                                                    <label className="flex items-center justify-center py-6 border-2 border-dashed border-hairline rounded-xl cursor-pointer hover:bg-surface-muted transition-colors">
                                                        <Upload size={16} className="mr-2" /> Upload Image
                                                        <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: url } }) } }} className="sr-only" />
                                                    </label>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}

                                {editingSection === 'features' && (
                                    <>
                                        <button onClick={() => patch({ features: [...features, { title: 'New Feature', description: 'Description' }] })} className="w-full flex items-center justify-center gap-2 py-2 border border-hairline rounded-lg text-sm font-medium hover:bg-surface-muted mb-4">
                                            <Plus size={16} /> Add Highlight
                                        </button>
                                        {features.map((f, idx) => (
                                            <div key={idx} className="p-3 bg-surface-muted rounded-lg border border-hairline relative">
                                                <button
                                                    onClick={async () => {
                                                        const ok = await confirm({ title: 'Remove this highlight?', message: 'You can add it back before publishing.', confirmText: 'Remove', isDestructive: true })
                                                        if (!ok) return
                                                        patch({ features: features.filter((_, i) => i !== idx) })
                                                    }}
                                                    className="absolute top-2 right-2 text-danger-fg p-1 hover:bg-surface rounded"
                                                ><Trash2 size={14} /></button>
                                                <Input label={`Highlight ${idx + 1}`} value={f.title} onChange={(v: string) => patch({ features: features.map((it, i) => (i === idx ? { ...it, title: v } : it)) })} />
                                                <Textarea label="Description" value={f.description} onChange={(v: string) => patch({ features: features.map((it, i) => (i === idx ? { ...it, description: v } : it)) })} />
                                            </div>
                                        ))}
                                    </>
                                )}

                                {editingSection === 'cta' && (
                                    <>
                                        <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                            <input type="checkbox" checked={config.cta?.enabled ?? true} onChange={(e) => patchCta({ enabled: e.target.checked })} className="rounded border-hairline text-brand-500 focus:ring-brand-500" />
                                            <span className="text-sm font-medium">Enable CTA Banner</span>
                                        </label>
                                        <div className={!config.cta?.enabled ? 'opacity-50 pointer-events-none' : ''}>
                                            <Input label="Headline" value={config.cta?.headline || ''} onChange={(v: string) => patchCta({ headline: v })} />
                                            <Input label="Subtext" value={config.cta?.description || ''} onChange={(v: string) => patchCta({ description: v })} />
                                            <Input label="Button Text" value={config.cta?.button_text || ''} onChange={(v: string) => patchCta({ button_text: v })} />
                                        </div>
                                    </>
                                )}
                                
                                {editingSection === 'contact' && (
                                    <>
                                        <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                            <input type="checkbox" checked={config.contact?.enabled ?? true} onChange={(e) => patchContact({ enabled: e.target.checked })} className="rounded border-hairline text-brand-500 focus:ring-brand-500" />
                                            <span className="text-sm font-medium">Enable Contact Section</span>
                                        </label>
                                        <div className={!config.contact?.enabled ? 'opacity-50 pointer-events-none' : ''}>
                                            <Input label="Phone Number" value={config.contact?.phone || ''} onChange={(v: string) => patchContact({ phone: v })} />
                                            <Input label="Email Address" value={config.contact?.email || ''} onChange={(v: string) => patchContact({ email: v })} />
                                            <Textarea label="Physical Address" value={config.contact?.address || ''} onChange={(v: string) => patchContact({ address: v })} />
                                            <Input label="Google Maps Link" value={config.contact?.map_address || ''} onChange={(v: string) => patchContact({ map_address: v })} placeholder="https://maps.google.com/..." />
                                            <Input label="Review Link (TripAdvisor/Google)" value={config.contact?.review_link || ''} onChange={(v: string) => patchContact({ review_link: v })} placeholder="https://..." />
                                        </div>
                                    </>
                                )}

                                {editingSection === 'gallery' && (
                                    <>
                                        <label className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-hairline rounded-lg text-sm font-medium cursor-pointer hover:bg-surface-muted mb-4">
                                            <Upload size={16} /> Upload Media
                                            <input type="file" accept="image/*,video/*" multiple onChange={async (e) => { 
                                                if (e.target.files && e.target.files.length > 0) { 
                                                    const files = Array.from(e.target.files);
                                                    const uploadPromises = files.map(async (file) => {
                                                        const type = file.type.startsWith('video/') ? 'video' : 'image';
                                                        const url = await uploadFile(file, type);
                                                        return url ? { image_url: url, caption: '', media_type: type as 'image' | 'video' } : null;
                                                    });
                                                    const newItems = (await Promise.all(uploadPromises)).filter((item) => item !== null) as { image_url: string, caption: string, media_type: 'image' | 'video' }[];
                                                    if (newItems.length > 0) {
                                                        await patchAndSave({ gallery: [...gallery, ...newItems] });
                                                    }
                                                } 
                                            }} className="sr-only" />
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {gallery.map((g, idx) => (
                                                <div key={idx} className="relative aspect-square rounded-lg overflow-hidden group border border-hairline">
                                                    {g.media_type === 'video' || g.image_url.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                                                        <video src={g.image_url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                                                    ) : (
                                                        <Image src={g.image_url} alt="" fill sizes="200px" className="object-cover" />
                                                    )}
                                                    <button onClick={() => patchAndSave({ gallery: gallery.filter((_, i) => i !== idx) })} className="absolute top-1 right-1 w-6 h-6 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"><X size={12} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}

                                {editingSection === 'footer' && (
                                    <>
                                        <label className="flex items-center gap-2 mb-4 cursor-pointer">
                                            <input type="checkbox" checked={config.footer?.enabled ?? true} onChange={(e) => patchFooter({ enabled: e.target.checked })} className="rounded border-hairline text-brand-500 focus:ring-brand-500" />
                                            <span className="text-sm font-medium">Enable Footer Section</span>
                                        </label>
                                        <div className={!config.footer?.enabled ? 'opacity-50 pointer-events-none' : ''}>
                                            <Input label="Copyright Text" value={config.footer?.copyright || ''} onChange={(v: string) => patchFooter({ copyright: v })} />
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Preview Canvas */}
                <div className="flex-1 bg-surface-muted overflow-y-auto relative p-4 md:p-8 flex items-start justify-center transition-all duration-300">
                    <div 
                        className={cn(
                            "bg-canvas rounded-xl shadow-2xl transition-all duration-500 ease-in-out relative overflow-y-auto overflow-x-hidden ring-1 ring-black/10 origin-top",
                            deviceMode === 'desktop' ? 'w-full max-w-5xl min-h-full' :
                            deviceMode === 'tablet' ? 'w-[768px] min-h-[1024px]' :
                            'w-[375px] min-h-[812px]'
                        )}
                    >
                        {/* Render actual website */}
                        <div className="w-full min-h-full pointer-events-none">
                            <HomepageRenderer config={config} onMenuClick={() => {}} />
                        </div>
                    </div>
                </div>

                {/* Right Sidebar */}
                <div className="w-80 bg-surface border-l border-hairline flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.02)]">
                    <div className="h-16 border-b border-hairline px-5 flex flex-col justify-center shrink-0">
                        <h2 className="text-sm font-semibold text-ink">Design & Branding</h2>
                        <p className="text-xs text-ink-muted">Global styles applied across site</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        
                        {/* Publish Status Toggle */}
                        <div className="border border-hairline rounded-xl p-4 bg-surface shadow-sm flex items-center justify-between cursor-pointer hover:bg-surface-muted transition-colors">
                            <div>
                                <h3 className="text-sm font-semibold text-ink">Site is public</h3>
                                <p className="text-xs text-ink-muted">Anyone can view your site</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" className="sr-only peer" defaultChecked />
                                <div className="w-9 h-5 bg-ink-muted/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-surface after:border-hairline after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                            </label>
                        </div>

                        {/* Branding / Logo */}
                        <div className="border border-hairline rounded-xl p-4 bg-surface shadow-sm space-y-4">
                            <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Brand Logo</h3>
                            {config.logo_url ? (
                                <div className="relative group p-2 border border-hairline rounded-lg flex justify-center bg-surface-muted">
                                    <Image src={config.logo_url} alt="Logo" width={160} height={80} className="object-contain h-16 w-auto" />
                                    <button onClick={() => patchAndSave({ logo_url: null })} className="absolute -top-2 -right-2 p-1.5 bg-danger-bg text-danger-fg rounded-full shadow-md"><X size={12} /></button>
                                </div>
                            ) : (
                                <label className="flex flex-col items-center justify-center p-4 border-2 border-dashed border-hairline rounded-lg cursor-pointer hover:bg-surface-muted transition-colors">
                                    <Upload size={16} className="mb-2 text-ink-muted" />
                                    <span className="text-xs font-medium">Upload Logo</span>
                                    <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ logo_url: url }) } }} className="sr-only" />
                                </label>
                            )}
                        </div>

                        {/* Template Accordion */}
                        <div className="border border-hairline rounded-xl overflow-hidden bg-surface shadow-sm">
                            <button onClick={() => toggleRightPanel('template')} className="w-full flex items-center justify-between p-4 bg-surface hover:bg-surface-muted transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-brand-50 text-brand-600 rounded-md"><Layout className="w-4 h-4" /></div>
                                    <span className="text-sm font-semibold text-ink">Layout Template</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 bg-brand-50 px-2 py-1 rounded-full">{config.template}</span>
                                    <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === 'template' ? "rotate-180" : "")} />
                                </div>
                            </button>
                            {expandedRightPanel === 'template' && (
                                <div className="p-4 border-t border-hairline bg-surface/50 grid grid-cols-1 gap-2">
                                    {(Object.keys(HOMEPAGE_TEMPLATES) as HomepageTemplate[]).map((template) => (
                                        <button 
                                            key={template}
                                            onClick={() => patchAndSave({ template })}
                                            className={cn("flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all", config.template === template ? 'border-brand-500 bg-brand-50/50' : 'border-hairline hover:border-brand-200 bg-surface')}
                                        >
                                            <span className="text-2xl">{HOMEPAGE_TEMPLATES[template].icon}</span>
                                            <div>
                                                <div className="text-sm font-bold text-ink">{HOMEPAGE_TEMPLATES[template].name}</div>
                                                <div className="text-[10px] text-ink-muted">{HOMEPAGE_TEMPLATES[template].description}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Theme Colors Accordion */}
                        <div className="border border-hairline rounded-xl overflow-hidden bg-surface shadow-sm">
                            <button onClick={() => toggleRightPanel('colors')} className="w-full flex items-center justify-between p-4 bg-surface hover:bg-surface-muted transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-blue-50 text-blue-600 rounded-md"><Palette className="w-4 h-4" /></div>
                                    <span className="text-sm font-semibold text-ink">Theme Colors</span>
                                </div>
                                <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === 'colors' ? "rotate-180" : "")} />
                            </button>
                            {expandedRightPanel === 'colors' && (
                                <div className="p-4 border-t border-hairline bg-surface/50 space-y-4">
                                    {[
                                        { key: 'theme_primary' as const, label: 'Primary (Buttons)' },
                                        { key: 'theme_secondary' as const, label: 'Secondary (Bg)' },
                                        { key: 'theme_accent' as const, label: 'Accent (Tags)' },
                                    ].map(({ key, label }) => (
                                        <div key={key} className="flex items-center justify-between">
                                            <span className="text-xs font-semibold text-ink">{label}</span>
                                            <label className="relative w-8 h-8 rounded-full shadow-sm cursor-pointer border border-hairline overflow-hidden" style={{ backgroundColor: config[key] || '#000' }}>
                                                <input type="color" value={config[key] || '#000'} onChange={(e) => patch({ [key]: e.target.value })} className="absolute -inset-10 opacity-0 cursor-pointer w-[200%] h-[200%]" />
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Social Links Accordion */}
                        <div className="border border-hairline rounded-xl overflow-hidden bg-surface shadow-sm">
                            <button onClick={() => toggleRightPanel('social')} className="w-full flex items-center justify-between p-4 bg-surface hover:bg-surface-muted transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-md"><Globe className="w-4 h-4" /></div>
                                    <span className="text-sm font-semibold text-ink">Social Links</span>
                                </div>
                                <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === 'social' ? "rotate-180" : "")} />
                            </button>
                            {expandedRightPanel === 'social' && (
                                <div className="p-4 border-t border-hairline bg-surface/50 space-y-3">
                                    <Input label="Instagram" value={config.social?.instagram || ''} onChange={(v: string) => patchSocial({ instagram: v })} placeholder="https://..." />
                                    <Input label="Facebook" value={config.social?.facebook || ''} onChange={(v: string) => patchSocial({ facebook: v })} placeholder="https://..." />
                                    <Input label="TikTok" value={config.social?.tiktok || ''} onChange={(v: string) => patchSocial({ tiktok: v })} placeholder="https://..." />
                                    <Input label="WhatsApp" value={config.social?.whatsapp || ''} onChange={(v: string) => patchSocial({ whatsapp: v })} placeholder="+123..." />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Full-screen preview modal */}
            {isPreviewOpen && (
                <div className="fixed inset-0 z-[100] bg-ink/90 backdrop-blur-md flex items-center justify-center p-4 sm:p-6">
                    <div className="bg-surface rounded-2xl w-full max-w-6xl h-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl border border-white/10 ring-1 ring-white/20">
                        <div className="flex items-center justify-between px-6 py-4 bg-ink text-white border-b border-white/10 shrink-0">
                            <div className="flex items-center gap-3">
                                <span className="font-black text-lg">Desktop Preview</span>
                                <span className="text-[10px] font-bold text-white/50 uppercase tracking-widest bg-surface/10 px-2.5 py-1 rounded-full">{config.template} template</span>
                            </div>
                            <button onClick={() => setIsPreviewOpen(false)} className="w-8 h-8 rounded-full bg-surface/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-surface/20 transition-all">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1 bg-canvas w-full">
                            <HomepageRenderer config={config} onMenuClick={() => setIsPreviewOpen(false)} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
