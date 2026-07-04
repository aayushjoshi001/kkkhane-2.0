'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { HomepageConfig, HomepageTemplate, HOMEPAGE_TEMPLATES } from '@/types/database'
import { Eye, Loader2, AlertCircle, Upload, X, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { uploadMedia } from '@/lib/uploadMedia'
import HomepageRenderer from '@/components/customer/homepage/HomepageRenderer'
import { useHomepageConfig } from '@/lib/hooks/useHomepageConfig'

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

type Tab = 'template' | 'branding' | 'hero' | 'about' | 'features' | 'gallery' | 'social' | 'contact' | 'theme' | 'footer'

const TABS: { id: Tab; label: string }[] = [
    { id: 'template', label: 'Template' },
    { id: 'branding', label: 'Branding' },
    { id: 'hero', label: 'Hero' },
    { id: 'about', label: 'About' },
    { id: 'features', label: 'Features' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'social', label: 'Social' },
    { id: 'contact', label: 'Contact' },
    { id: 'theme', label: 'Theme' },
    { id: 'footer', label: 'Footer' },
]

// ---- small shared field primitives -----------------------------------------
const inputCls =
    'w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3'

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
    return (
        <div>
            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">{label}</label>
            <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
        </div>
    )
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <div>
            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">{label}</label>
            <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls} />
        </div>
    )
}

function UrlField({ label, value, placeholder, onSave }: { label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
    const [draft, setDraft] = useState(value)
    useEffect(() => { setDraft(value) }, [value])
    const dirty = draft.trim() !== (value || '').trim()
    return (
        <div className="mt-3">
            <label className="block text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-2">{label}</label>
            <div className="flex gap-3">
                <input
                    type="url"
                    value={draft}
                    placeholder={placeholder}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onSave(draft.trim()) }}
                    className={`flex-1 ${inputCls}`}
                />
                <button
                    type="button"
                    onClick={() => onSave(draft.trim())}
                    disabled={!dirty}
                    className="px-5 py-2.5 text-sm font-bold bg-surface border border-hairline text-ink rounded-[var(--r-md)] disabled:opacity-40 hover:bg-surface-muted transition-colors shadow-sm focus-ring"
                >
                    Set
                </button>
            </div>
        </div>
    )
}

function SaveButton({ onClick, isSaving, label = 'Save Changes' }: { onClick: () => void; isSaving: boolean; label?: string }) {
    return (
        <button
            onClick={onClick}
            disabled={isSaving}
            className="w-full px-6 py-3.5 bg-brand-500 text-white rounded-[var(--r-md)] hover:bg-brand-600 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 font-bold focus-ring mt-6 flex justify-center items-center gap-2"
        >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
            {isSaving ? 'Saving…' : label}
        </button>
    )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center justify-between cursor-pointer py-2">
            <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider">{label}</span>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative w-12 h-6 rounded-full transition-colors border ${checked ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-hairline'}`}
            >
                <span className={`absolute top-[1px] left-[1px] w-[20px] h-[20px] bg-white rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-transform ${checked ? 'translate-x-6' : ''}`} />
            </button>
        </label>
    )
}

export default function HomepageManager({ restaurantId }: HomepageManagerProps) {
    const { config: fetchedConfig, isLoading, error } = useHomepageConfig(restaurantId)
    const [config, setConfig] = useState<HomepageConfig>(DEFAULT_CONFIG)
    const [isSaving, setIsSaving] = useState(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<Tab>('template')

    useEffect(() => {
        if (fetchedConfig) {
            setConfig({ ...DEFAULT_CONFIG, ...fetchedConfig })
        } else if (fetchedConfig === null) {
            setConfig({ ...DEFAULT_CONFIG, restaurant_id: restaurantId })
        }
    }, [fetchedConfig, restaurantId])

    // generic merge helpers
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

    // Direct-to-Storage upload (signed URL) so large hero videos / gallery clips
    // aren't blocked by the serverless request-body cap on /api/upload.
    const uploadFile = async (file: File, type: 'image' | 'video'): Promise<string | null> => {
        const toastId = toast.loading(type === 'video' ? 'Uploading video…' : 'Uploading…')
        const { url, error } = await uploadMedia(file, type, 'homepage')
        toast.dismiss(toastId)
        if (error || !url) {
            toast.error(error || 'Upload failed')
            return null
        }
        return url
    }

    const saveConfig = async (updatedConfig: HomepageConfig) => {
        setIsSaving(true)
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
            toast.success('Homepage updated successfully')
            setConfig({ ...DEFAULT_CONFIG, ...(data.config || updatedConfig) })
        } catch (err) {
            toast.error('Error saving homepage')
            console.error(err)
        } finally {
            setIsSaving(false)
        }
    }

    const handleTemplateSelect = async (template: HomepageTemplate) => {
        const next = { ...config, template }
        setConfig(next)
        await saveConfig(next)
    }

    const save = () => saveConfig(config)

    // Apply a change and persist immediately — used for media (logo, images,
    // videos, gallery) so uploads "stick" without a separate Save click.
    const patchAndSave = async (p: Partial<HomepageConfig>) => {
        const next = { ...config, ...p }
        setConfig(next)
        await saveConfig(next)
    }

    if (isLoading) {
        return (
            <div className="p-8 text-center">
                <Loader2 size={32} className="animate-spin mx-auto mb-4 text-blue-500" />
                <p className="text-gray-500">Loading homepage configuration...</p>
            </div>
        )
    }

    if (error && error !== 'No homepage config found') {
        return (
            <div className="p-8 text-center">
                <AlertCircle size={32} className="mx-auto mb-4 text-red-500" />
                <p className="text-gray-900 font-medium mb-2">Failed to load homepage</p>
                <p className="text-gray-500 text-sm mb-4">{error}</p>
                <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                    Retry
                </button>
            </div>
        )
    }

    const features = Array.isArray(config.features) ? config.features : []
    const gallery = Array.isArray(config.gallery) ? config.gallery : []

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left: Editor */}
            <div className="lg:col-span-2 space-y-6">
                {/* Tabs */}
                <div className="flex flex-wrap gap-2 border-b border-hairline">
                    {TABS.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-3 text-[11px] font-extrabold uppercase tracking-wider transition-all border-b-2 -mb-[2px] ${
                                activeTab === tab.id ? 'border-brand-500 text-brand-500' : 'border-transparent text-ink-subtle hover:text-ink hover:border-hairline'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div className="bg-surface rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] p-6">
                {/* Template */}
                {activeTab === 'template' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Select Template</h3>
                        <div className="grid grid-cols-2 gap-5">
                            {(Object.keys(HOMEPAGE_TEMPLATES) as HomepageTemplate[]).map((template) => (
                                <button
                                    key={template}
                                    onClick={() => handleTemplateSelect(template)}
                                    className={`p-6 rounded-[var(--r-md)] border-2 text-center transition-all focus-ring ${
                                        config.template === template ? 'border-brand-500 bg-brand-50 shadow-[0_4px_12px_rgba(251,99,3,0.15)] -translate-y-0.5' : 'border-hairline bg-surface hover:border-brand-200 hover:shadow-sm'
                                    }`}
                                >
                                    <div className="text-4xl mb-3 flex justify-center drop-shadow-sm">{HOMEPAGE_TEMPLATES[template].icon}</div>
                                    <div className="font-extrabold text-ink">{HOMEPAGE_TEMPLATES[template].name}</div>
                                    <div className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mt-2">{HOMEPAGE_TEMPLATES[template].description}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Branding / Logo */}
                {activeTab === 'branding' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Logo</h3>
                        <p className="text-sm font-medium text-ink-subtle -mt-2">Shown in the homepage navbar, hero and footer. Defaults to your <strong className="text-ink">Brand &amp; Theme</strong> logo until you set one here.</p>
                        {config.logo_url && (
                            <div className="relative inline-block mt-2">
                                <Image src={config.logo_url} alt="Logo" width={200} height={80} className="h-24 w-auto object-contain rounded-card border border-hairline bg-surface-muted/30 p-3 shadow-sm" />
                                <button onClick={() => patchAndSave({ logo_url: null })} className="absolute -top-3 -right-3 w-8 h-8 bg-danger-bg border border-danger-fg/20 text-danger-fg rounded-full flex items-center justify-center hover:bg-danger-fg hover:text-white transition-colors shadow-sm focus-ring">
                                    <X size={14} />
                                </button>
                            </div>
                        )}
                        <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                            <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{config.logo_url ? 'Replace Logo' : 'Upload Logo'}</span>
                            <input
                                type="file"
                                accept="image/*"
                                onChange={async (e) => {
                                    if (e.target.files?.[0]) {
                                        const url = await uploadFile(e.target.files[0], 'image')
                                        if (url) await patchAndSave({ logo_url: url })
                                    }
                                }}
                                className="hidden"
                            />
                        </label>
                    </div>
                )}

                {/* Hero */}
                {activeTab === 'hero' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Hero Section</h3>
                        <div className="space-y-4">
                            <TextField label="Title" value={config.hero_title || ''} onChange={(v) => patch({ hero_title: v })} />
                            <TextField label="Subtitle" value={config.hero_subtitle || ''} onChange={(v) => patch({ hero_subtitle: v })} />
                            <TextField label="CTA Button Text" value={config.hero_cta_text || ''} onChange={(v) => patch({ hero_cta_text: v })} placeholder="View Menu" />
                        </div>

                        {/* Image */}
                        <div className="pt-2 border-t border-hairline mt-4">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Hero Image</label>
                            {config.hero_image_url && (
                                <div className="mb-4 relative group h-40 w-full">
                                    <Image src={config.hero_image_url} alt="Hero" fill sizes="(max-width: 768px) 100vw, 500px" className="object-cover rounded-card border border-hairline" />
                                    <button onClick={() => patchAndSave({ hero_image_url: null })} className="absolute top-2 right-2 w-8 h-8 bg-danger-bg border border-danger-fg/20 text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm focus-ring">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                                <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{config.hero_image_url ? 'Replace Image' : 'Upload Image'}</span>
                                <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ hero_image_url: url }) } }} className="hidden" />
                            </label>
                            <UrlField label="…or paste an image URL" value={config.hero_image_url || ''} placeholder="https://…/image.jpg" onSave={(v) => patchAndSave({ hero_image_url: v || null })} />
                        </div>

                        {/* Video */}
                        <div className="pt-4 border-t border-hairline mt-4">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Hero Video <span className="text-ink-muted">(optional)</span></label>
                            {config.hero_video_url && (
                                <div className="mb-4 relative group">
                                    <video src={config.hero_video_url} className="h-40 w-full object-cover rounded-card border border-hairline" controls />
                                    <button onClick={() => patchAndSave({ hero_video_url: null })} className="absolute top-2 right-2 w-8 h-8 bg-danger-bg border border-danger-fg/20 text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm focus-ring">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                                <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{config.hero_video_url ? 'Replace Video' : 'Upload Video (MP4 / WebM / MOV)'}</span>
                                <input type="file" accept="video/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'video'); if (url) await patchAndSave({ hero_video_url: url }) } }} className="hidden" />
                            </label>
                            <UrlField label="…or paste a video URL (e.g. a hosted .mp4)" value={config.hero_video_url || ''} placeholder="https://…/video.mp4" onSave={(v) => patchAndSave({ hero_video_url: v || null })} />
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* About */}
                {activeTab === 'about' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">About Section</h3>
                        <Toggle label="Show this section" checked={config.about?.enabled ?? true} onChange={(v) => patchAbout({ enabled: v })} />
                        
                        <div className="space-y-4 pt-2">
                            <TextField label="Title" value={config.about?.title || ''} onChange={(v) => patchAbout({ title: v })} />
                            <TextArea label="Description" value={config.about?.description || ''} onChange={(v) => patchAbout({ description: v })} />
                        </div>
                        
                        <div className="pt-4 border-t border-hairline mt-4">
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-3">Image</label>
                            {config.about?.image_url && (
                                <div className="mb-4 relative group inline-block">
                                    <Image src={config.about.image_url} alt="About" width={300} height={128} className="h-40 w-auto object-cover rounded-card border border-hairline shadow-sm" />
                                    <button onClick={() => patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: '' } })} className="absolute -top-3 -right-3 w-8 h-8 bg-danger-bg border border-danger-fg/20 text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm focus-ring">
                                        <X size={14} />
                                    </button>
                                </div>
                            )}
                            <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                                <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{config.about?.image_url ? 'Replace Image' : 'Upload Image'}</span>
                                <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: url } }) } }} className="hidden" />
                            </label>
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* Features */}
                {activeTab === 'features' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Features</h3>
                        {features.map((f, idx) => (
                            <div key={idx} className="p-5 border border-hairline bg-surface-muted/30 rounded-card space-y-4 relative group transition-all">
                                <button
                                    onClick={() => patch({ features: features.filter((_, i) => i !== idx) })}
                                    className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center bg-surface border border-hairline text-ink-subtle hover:text-danger-fg hover:bg-danger-bg hover:border-danger-fg/30 transition-all shadow-sm focus-ring"
                                >
                                    <Trash2 size={14} />
                                </button>
                                <div className="pr-10 space-y-4">
                                    <TextField label={`Feature ${idx + 1} Title`} value={f.title} onChange={(v) => patch({ features: features.map((it, i) => (i === idx ? { ...it, title: v } : it)) })} />
                                    <TextField label="Description" value={f.description} onChange={(v) => patch({ features: features.map((it, i) => (i === idx ? { ...it, description: v } : it)) })} />
                                </div>
                            </div>
                        ))}
                        <button
                            onClick={() => patch({ features: [...features, { title: 'New Feature', description: '' }] })}
                            className="flex items-center gap-2 text-sm font-bold text-brand-500 hover:text-brand-600 py-2 px-3 hover:bg-brand-50 rounded-[var(--r-md)] transition-colors w-fit"
                        >
                            <Plus size={16} /> Add Feature
                        </button>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* Gallery */}
                {activeTab === 'gallery' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Gallery</h3>
                        <p className="text-sm font-medium text-ink-subtle -mt-2">Showcase photos of your food, space, or team.</p>
                        {gallery.length > 0 && (
                            <div className="grid grid-cols-3 gap-4">
                                {gallery.map((g, idx) => (
                                    <div key={idx} className="space-y-2 bg-surface-muted/30 p-2 rounded-card border border-hairline">
                                        <div className="relative group aspect-square bg-surface border border-hairline rounded-[var(--r-md)] overflow-hidden shadow-sm">
                                            {g.media_type === 'video' || g.image_url.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                                                <video src={g.image_url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                                            ) : (
                                                <Image src={g.image_url} alt={g.caption || ''} fill sizes="200px" className="object-cover" />
                                            )}
                                            <button onClick={() => patchAndSave({ gallery: gallery.filter((_, i) => i !== idx) })} className="absolute top-2 right-2 w-7 h-7 bg-danger-bg border border-danger-fg/20 text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-sm focus-ring">
                                                <X size={12} />
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            value={g.caption || ''}
                                            placeholder="Caption"
                                            onChange={(e) => patch({ gallery: gallery.map((it, i) => (i === idx ? { ...it, caption: e.target.value } : it)) })}
                                            className="w-full px-3 py-2 text-xs font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] focus:outline-none focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] placeholder:text-ink-muted"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="pt-2">
                            <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                                <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">Add Media</span>
                                <input type="file" accept="image/*,video/*" multiple onChange={async (e) => { 
                                    if (e.target.files && e.target.files.length > 0) { 
                                        const files = Array.from(e.target.files);
                                        
                                        const uploadPromises = files.map(async (file) => {
                                            const type = file.type.startsWith('video/') ? 'video' : 'image';
                                            const url = await uploadFile(file, type);
                                            if (url) {
                                                return { image_url: url, caption: '', media_type: type as 'image' | 'video' };
                                            }
                                            return null;
                                        });

                                        const newItems = (await Promise.all(uploadPromises)).filter((item) => item !== null);
                                        
                                        if (newItems.length > 0) {
                                            await patchAndSave({ gallery: [...gallery, ...newItems] });
                                        }
                                    } 
                                }} className="hidden" />
                            </label>
                        </div>
                        <UrlField label="…or paste an image/video URL to add" value="" placeholder="https://…/media.jpg" onSave={(v) => { 
                            if (v) {
                                const type = v.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? 'video' : 'image';
                                patchAndSave({ gallery: [...gallery, { image_url: v, caption: '', media_type: type }] });
                            }
                        }} />
                        <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mt-4">Media saves automatically. Use the button below to save caption edits.</p>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* Social */}
                {activeTab === 'social' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Social Media</h3>
                        <p className="text-sm font-medium text-ink-subtle -mt-2">Paste a full URL or a handle. WhatsApp accepts a phone number.</p>
                        <div className="space-y-4 pt-2">
                            <TextField label="Facebook" value={config.social?.facebook || ''} onChange={(v) => patchSocial({ facebook: v })} placeholder="https://facebook.com/yourpage" />
                            <TextField label="Instagram" value={config.social?.instagram || ''} onChange={(v) => patchSocial({ instagram: v })} placeholder="@yourhandle" />
                            <TextField label="WhatsApp" value={config.social?.whatsapp || ''} onChange={(v) => patchSocial({ whatsapp: v })} placeholder="+9779800000000" />
                            <TextField label="TikTok" value={config.social?.tiktok || ''} onChange={(v) => patchSocial({ tiktok: v })} placeholder="@yourhandle" />
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* Contact / Map */}
                {activeTab === 'contact' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Contact & Location</h3>
                        <Toggle label="Show this section" checked={config.contact?.enabled ?? true} onChange={(v) => patchContact({ enabled: v })} />
                        <div className="space-y-4 pt-2">
                            <TextField label="Google Review Link" value={config.contact?.review_link || ''} onChange={(v) => patchContact({ review_link: v })} placeholder="https://g.page/r/..." />
                            <TextField label="Address" value={config.contact?.map_address || ''} onChange={(v) => patchContact({ map_address: v })} placeholder="123 Main St, City" />
                            <div>
                                <TextField label="Map Embed URL" value={config.contact?.map_embed_url || ''} onChange={(v) => patchContact({ map_embed_url: v })} placeholder="(optional) Google Maps embed src" />
                                <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mt-2">Leave the embed URL blank to auto-generate a map from the address.</p>
                            </div>
                            <TextField label="Phone" value={config.contact?.phone || ''} onChange={(v) => patchContact({ phone: v })} placeholder="+977 980 000 0000" />
                            <TextField label="Email" value={config.contact?.email || ''} onChange={(v) => patchContact({ email: v })} placeholder="hello@restaurant.com" />
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}

                {/* Theme */}
                {activeTab === 'theme' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Homepage Theme Colors</h3>
                        <p className="text-sm font-medium text-ink-subtle -mt-2">These colors apply to the homepage only. The app-wide brand colors are set in <strong className="text-ink">Brand &amp; Theme</strong>.</p>
                        <div className="space-y-4 pt-2">
                            {([
                                { key: 'theme_primary' as const, label: 'Primary', default: '#FB6303' },
                                { key: 'theme_secondary' as const, label: 'Secondary', default: '#1B263B' },
                                { key: 'theme_accent' as const, label: 'Accent', default: '#EC4899' },
                            ]).map(({ key, label, default: def }) => {
                                const val = config[key] || def
                                return (
                                    <div key={key} className="flex items-center gap-4 bg-surface-muted/30 p-4 rounded-card border border-hairline">
                                        <label className="relative w-12 h-12 rounded-xl border border-hairline shadow-sm cursor-pointer shrink-0" style={{ backgroundColor: val }} title="Click to pick color">
                                            <input type="color" value={val} onChange={(e) => patch({ [key]: e.target.value })} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
                                        </label>
                                        <div className="flex-1">
                                            <p className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">{label}</p>
                                            <input
                                                type="text"
                                                value={val}
                                                maxLength={7}
                                                onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) patch({ [key]: v }) }}
                                                className="w-32 px-3 py-2 text-sm font-bold text-ink font-mono bg-surface border border-hairline rounded-[var(--r-md)] focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all uppercase"
                                                placeholder="#000000"
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} label="Save Colors" />
                    </div>
                )}

                {/* Footer */}
                {activeTab === 'footer' && (
                    <div className="space-y-5">
                        <h3 className="text-h3 font-extrabold text-ink">Footer & Call to Action</h3>
                        <Toggle label="Show footer" checked={config.footer?.enabled ?? true} onChange={(v) => patchFooter({ enabled: v })} />
                        <div className="space-y-4">
                            <TextField label="Copyright Text" value={config.footer?.copyright || ''} onChange={(v) => patchFooter({ copyright: v })} />
                        </div>

                        <div className="pt-6 border-t border-hairline space-y-4">
                            <h3 className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Call to Action Banner</h3>
                            <div className="bg-surface-muted/30 p-5 rounded-card border border-hairline space-y-4">
                                <Toggle label="Show CTA banner" checked={config.cta?.enabled ?? true} onChange={(v) => patchCta({ enabled: v })} />
                                <TextField label="CTA Headline" value={config.cta?.headline || ''} onChange={(v) => patchCta({ headline: v })} />
                                <TextField label="CTA Description" value={config.cta?.description || ''} onChange={(v) => patchCta({ description: v })} />
                                <TextField label="CTA Button Text" value={config.cta?.button_text || ''} onChange={(v) => patchCta({ button_text: v })} />
                            </div>
                        </div>
                        <SaveButton onClick={save} isSaving={isSaving} />
                    </div>
                )}
                </div>
            </div>

            {/* Right: Live Preview */}
            <div className="lg:col-span-1">
                <div className="sticky top-6 bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                    <div className="px-5 py-4 border-b border-hairline flex items-center gap-3 bg-surface-muted/30">
                        <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-500">
                            <Eye size={16} />
                        </div>
                        <h3 className="font-extrabold text-ink">Live Preview</h3>
                        <span className="ml-auto text-[10px] font-bold text-ink-subtle uppercase tracking-wider bg-surface border border-hairline px-2 py-1 rounded-[var(--r-md)]">375px view</span>
                    </div>
                    <div className="relative bg-surface-muted overflow-hidden" style={{ height: 520 }}>
                        <div style={{ transform: 'scale(0.38)', transformOrigin: 'top left', width: `${100 / 0.38}%`, pointerEvents: 'none', minHeight: `${520 / 0.38}px` }}>
                            <HomepageRenderer config={config} onMenuClick={() => {}} />
                        </div>
                    </div>
                    <div className="p-4 border-t border-hairline bg-surface text-center">
                        <button onClick={() => setIsPreviewOpen(true)} className="text-[11px] font-bold uppercase tracking-wider text-brand-500 hover:text-brand-600 focus-ring py-1 px-3 rounded-[var(--r-md)] transition-colors">
                            Open full preview →
                        </button>
                    </div>
                </div>
            </div>

            {/* Full-screen preview modal */}
            {isPreviewOpen && (
                <div className="fixed inset-0 z-50 bg-ink/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
                    <div className="bg-surface rounded-[var(--r-lg)] w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-[0_24px_48px_rgba(0,0,0,0.2)]">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline bg-surface-muted/30">
                            <div className="flex items-center gap-3">
                                <span className="font-extrabold text-ink text-h3">Full Preview</span>
                                <span className="text-[11px] font-bold text-ink-subtle uppercase tracking-wider bg-surface border border-hairline px-2 py-1 rounded-[var(--r-md)]">{config.template} template</span>
                            </div>
                            <button onClick={() => setIsPreviewOpen(false)} className="w-8 h-8 rounded-full bg-surface border border-hairline flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors shadow-sm focus-ring">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1 bg-surface-muted">
                            <HomepageRenderer config={config} onMenuClick={() => setIsPreviewOpen(false)} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
