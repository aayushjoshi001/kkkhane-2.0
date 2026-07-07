'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { HomepageConfig, HomepageTemplate, HOMEPAGE_TEMPLATES } from '@/types/database'
import { Eye, Loader2, AlertCircle, Upload, X, Plus, Trash2, ChevronRight, ChevronLeft, CheckCircle2, ImageIcon } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { uploadMedia } from '@/lib/uploadMedia'
import HomepageRenderer from '@/components/customer/homepage/HomepageRenderer'
import { useHomepageConfig } from '@/lib/hooks/useHomepageConfig'
import { motion, AnimatePresence } from 'framer-motion'

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

type Tab = 'template' | 'branding' | 'theme' | 'hero' | 'about' | 'features' | 'cta' | 'gallery' | 'contact' | 'footer'

const STEPS: { id: Tab; label: string; desc: string }[] = [
    { id: 'template', label: 'Template', desc: 'Choose layout' },
    { id: 'branding', label: 'Branding', desc: 'Logo & Identity' },
    { id: 'theme', label: 'Theme Colors', desc: 'Brand palette' },
    { id: 'hero', label: 'Hero Banner', desc: 'First impression' },
    { id: 'about', label: 'About Us', desc: 'Your story' },
    { id: 'features', label: 'Highlights', desc: 'Why choose us' },
    { id: 'cta', label: 'Action Banner', desc: 'Drive orders' },
    { id: 'gallery', label: 'Gallery', desc: 'Visual showcase' },
    { id: 'contact', label: 'Location', desc: 'Map & Phone' },
    { id: 'footer', label: 'Footer & Social', desc: 'Final details' },
]

// ---- Shared UI Primitives ----
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    useEffect(() => { setDraft(value) }, [value])
    const dirty = draft.trim() !== (value || '').trim()
    return (
        <div className="mt-4">
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-center justify-between cursor-pointer py-3 px-4 border border-hairline rounded-[var(--r-md)] bg-surface-muted/30 hover:bg-surface-muted/50 transition-colors">
            <span className="text-[12px] font-extrabold text-ink tracking-wide">{label}</span>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative w-12 h-6 rounded-full transition-colors border ${checked ? 'bg-brand-500 border-brand-500' : 'bg-surface-muted border-hairline'}`}
            >
                <span className={`absolute top-[1px] left-[1px] w-[20px] h-[20px] bg-surface rounded-full shadow-[0_2px_4px_rgba(0,0,0,0.1)] transition-transform ${checked ? 'translate-x-6' : ''}`} />
            </button>
        </label>
    )
}

// ---- Main Component ----
export default function HomepageManager({ restaurantId }: HomepageManagerProps) {
    const { config: fetchedConfig, isLoading, error } = useHomepageConfig(restaurantId)
    const [config, setConfig] = useState<HomepageConfig>(DEFAULT_CONFIG)
    const [isSaving, setIsSaving] = useState(false)
    const [isPreviewOpen, setIsPreviewOpen] = useState(false)
    const [currentStepIndex, setCurrentStepIndex] = useState(0)

    useEffect(() => {
        if (fetchedConfig) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConfig({ ...DEFAULT_CONFIG, ...fetchedConfig })
        } else if (fetchedConfig === null) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setConfig({ ...DEFAULT_CONFIG, restaurant_id: restaurantId })
        }
    }, [fetchedConfig, restaurantId])

    const activeTab = STEPS[currentStepIndex]?.id || 'template'

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

    const uploadFile = async (file: File, type: 'image' | 'video'): Promise<string | null> => {
        const toastId = toast.loading(type === 'video' ? 'Uploading video…' : 'Uploading image…')
        const { url, error } = await uploadMedia(file, type, 'homepage')
        toast.dismiss(toastId)
        if (error || !url) {
            toast.error(error || 'Upload failed')
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

    const handleNext = async () => {
        await saveConfig(config, true)
        if (currentStepIndex < STEPS.length - 1) {
            setCurrentStepIndex(currentStepIndex + 1)
        } else {
            toast.success('All steps completed & saved!')
        }
    }

    const handlePrev = () => {
        if (currentStepIndex > 0) setCurrentStepIndex(currentStepIndex - 1)
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
                <button onClick={() => window.location.reload()} className="px-6 py-2.5 bg-danger-fg text-white font-bold rounded-[var(--r-md)] hover:opacity-90">
                    Retry Connection
                </button>
            </div>
        )
    }

    const features = Array.isArray(config.features) ? config.features : []
    const gallery = Array.isArray(config.gallery) ? config.gallery : []

    const progressPercentage = ((currentStepIndex + 1) / STEPS.length) * 100

    return (
        <div className="flex flex-col lg:flex-row gap-8 min-h-[80vh]">
            
            {/* LEFT: Builder Panel */}
            <div className="flex-1 flex flex-col min-w-0 max-w-3xl">
                
                {/* Progress Header */}
                <div className="bg-surface rounded-[var(--r-xl)] border border-hairline shadow-sm p-5 mb-6">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <p className="text-brand-500 font-extrabold text-[11px] uppercase tracking-widest mb-1">Step {currentStepIndex + 1} of {STEPS.length}</p>
                            <h2 className="text-xl font-black text-ink">{STEPS[currentStepIndex].label}</h2>
                        </div>
                        <div className="text-right hidden sm:block">
                            <p className="text-ink-subtle text-sm font-medium">{STEPS[currentStepIndex].desc}</p>
                        </div>
                    </div>
                    {/* Progress bar line */}
                    <div className="h-2 w-full bg-surface-muted rounded-full overflow-hidden flex">
                        <motion.div 
                            className="h-full bg-brand-500"
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercentage}%` }}
                            transition={{ duration: 0.4, ease: "easeInOut" }}
                        />
                    </div>
                </div>

                {/* Step Content Area */}
                <div className="bg-surface rounded-[var(--r-xl)] border border-hairline shadow-[0_12px_40px_rgba(0,0,0,0.04)] p-6 sm:p-8 flex-1 relative flex flex-col">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -20 }}
                            transition={{ duration: 0.2 }}
                            className="flex-1 space-y-6"
                        >
                            {/* --- 1. Template --- */}
                            {activeTab === 'template' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Select Architecture</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Choose the foundational layout for your website. You can change this at any time without losing content.</p>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                        {(Object.keys(HOMEPAGE_TEMPLATES) as HomepageTemplate[]).map((template) => (
                                            <button
                                                type="button"
                                                key={template}
                                                onClick={() => {
                                                    patchAndSave({ template })
                                                }}
                                                className={`p-6 rounded-[var(--r-lg)] border-2 text-left transition-all focus-ring relative overflow-hidden ${
                                                    config.template === template 
                                                    ? 'border-brand-500 bg-brand-50/50 shadow-[0_8px_24px_rgba(251,99,3,0.12)] -translate-y-1' 
                                                    : 'border-hairline bg-surface hover:border-brand-300 hover:shadow-md'
                                                }`}
                                            >
                                                {config.template === template && (
                                                    <div className="absolute top-4 right-4 text-brand-500">
                                                        <CheckCircle2 size={24} className="fill-brand-100" />
                                                    </div>
                                                )}
                                                <div className="text-4xl mb-4 text-brand-500 drop-shadow-sm">{HOMEPAGE_TEMPLATES[template].icon}</div>
                                                <div className="font-extrabold text-ink text-lg">{HOMEPAGE_TEMPLATES[template].name}</div>
                                                <div className="text-xs font-bold text-ink-subtle uppercase tracking-wider mt-2 leading-relaxed">{HOMEPAGE_TEMPLATES[template].description}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* --- 2. Branding --- */}
                            {activeTab === 'branding' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Brand Logo</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Upload a high-resolution logo (PNG with transparent background recommended).</p>
                                    </div>
                                    
                                    <div className="bg-surface-muted/20 border border-hairline p-8 rounded-[var(--r-lg)] flex flex-col items-center justify-center border-dashed relative">
                                        {config.logo_url ? (
                                            <div className="flex flex-col items-center">
                                                <div className="relative group">
                                                    <Image src={config.logo_url} alt="Logo" width={240} height={100} className="h-28 w-auto object-contain drop-shadow-md bg-surface p-4 rounded-xl border border-hairline" style={{ width: 'auto' }} />
                                                    <button onClick={() => patchAndSave({ logo_url: null })} className="absolute -top-3 -right-3 w-8 h-8 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center hover:scale-110 transition-transform shadow-md border-2 border-white">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                                <label className="mt-6 text-sm font-bold text-brand-500 hover:text-brand-600 cursor-pointer flex items-center gap-2 px-4 py-2 bg-brand-50 rounded-full">
                                                    <Upload size={16} /> Replace Logo
                                                    <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ logo_url: url }) } }} className="sr-only" />
                                                </label>
                                            </div>
                                        ) : (
                                            <label className="flex flex-col items-center cursor-pointer group p-8">
                                                <div className="w-16 h-16 rounded-full bg-brand-50 text-brand-500 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-sm">
                                                    <Upload size={24} />
                                                </div>
                                                <span className="text-lg font-extrabold text-ink group-hover:text-brand-500 transition-colors">Click to upload logo</span>
                                                <span className="text-sm font-medium text-ink-subtle mt-2">SVG, PNG, or JPG (max. 5MB)</span>
                                                <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ logo_url: url }) } }} className="sr-only" />
                                            </label>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* --- 3. Theme --- */}
                            {activeTab === 'theme' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Color Palette</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Define the primary colors that represent your restaurant. These will style buttons, accents, and backgrounds.</p>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                        {([
                                            { key: 'theme_primary' as const, label: 'Primary Action', desc: 'Main buttons & highlights', default: '#FB6303' },
                                            { key: 'theme_secondary' as const, label: 'Secondary', desc: 'Backgrounds & footers', default: '#1B263B' },
                                            { key: 'theme_accent' as const, label: 'Accent', desc: 'Tags & small details', default: '#EC4899' },
                                        ]).map(({ key, label, desc, default: def }) => {
                                            const val = config[key] || def
                                            return (
                                                <div key={key} className="bg-surface-muted/30 p-5 rounded-[var(--r-lg)] border border-hairline flex flex-col items-center text-center">
                                                    <label className="relative w-20 h-20 rounded-full border-4 border-white shadow-lg cursor-pointer mb-4 hover:scale-105 transition-transform overflow-hidden" style={{ backgroundColor: val }} title="Click to pick color">
                                                        <input type="color" value={val} onChange={(e) => patch({ [key]: e.target.value })} className="absolute -inset-10 opacity-0 cursor-pointer w-[200%] h-[200%]" />
                                                    </label>
                                                    <p className="font-extrabold text-ink mb-1">{label}</p>
                                                    <p className="text-[10px] font-bold text-ink-subtle uppercase tracking-wider mb-3 h-6">{desc}</p>
                                                    <input
                                                        type="text"
                                                        value={val}
                                                        maxLength={7}
                                                        onChange={(e) => { const v = e.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(v)) patch({ [key]: v }) }}
                                                        className="w-full text-center px-3 py-2 text-sm font-bold text-ink font-mono bg-surface border border-hairline rounded-[var(--r-md)] focus-ring uppercase shadow-inner"
                                                    />
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* --- 4. Hero --- */}
                            {activeTab === 'hero' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Welcome Banner</h3>
                                        <p className="text-sm font-medium text-ink-subtle">The very first thing customers see. Make it appetizing and welcoming.</p>
                                    </div>
                                    
                                    <div className="space-y-5">
                                        <TextField label="Headline (H1)" value={config.hero_title || ''} onChange={(v) => patch({ hero_title: v })} placeholder="E.g. Authentic Italian Cuisine" />
                                        <TextField label="Subtitle" value={config.hero_subtitle || ''} onChange={(v) => patch({ hero_subtitle: v })} placeholder="E.g. Experience the taste of Rome in the heart of the city." />
                                        <TextField label="Main Button Text" value={config.hero_cta_text || ''} onChange={(v) => patch({ hero_cta_text: v })} placeholder="E.g. View Menu & Order" />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 border-t border-hairline">
                                        {/* Image */}
                                        <div className="space-y-3">
                                            <label className="block text-[11px] font-bold text-ink uppercase tracking-wider">Background Image</label>
                                            {config.hero_image_url ? (
                                                <div className="relative aspect-video rounded-xl overflow-hidden border border-hairline group shadow-sm">
                                                    <Image src={config.hero_image_url} alt="Hero" fill className="object-cover" />
                                                    <button onClick={() => patchAndSave({ hero_image_url: null })} className="absolute top-2 right-2 w-8 h-8 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center hover:scale-110 transition-transform">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <label className="flex flex-col items-center justify-center aspect-video border-2 border-dashed border-brand-500/30 bg-brand-50/30 rounded-xl cursor-pointer hover:bg-brand-50 transition-colors">
                                                    <Upload size={20} className="text-brand-500 mb-2" />
                                                    <span className="text-xs font-bold text-brand-600">Upload Image</span>
                                                    <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ hero_image_url: url }) } }} className="sr-only" />
                                                </label>
                                            )}
                                        </div>

                                        {/* Video */}
                                        <div className="space-y-3">
                                            <label className="block text-[11px] font-bold text-ink uppercase tracking-wider flex items-center justify-between">Background Video <span className="text-ink-muted lowercase normal-case font-medium">(optional overlay)</span></label>
                                            {config.hero_video_url ? (
                                                <div className="relative aspect-video rounded-xl overflow-hidden border border-hairline group shadow-sm">
                                                    <video src={config.hero_video_url} className="w-full h-full object-cover" controls={false} autoPlay muted loop />
                                                    <button onClick={() => patchAndSave({ hero_video_url: null })} className="absolute top-2 right-2 w-8 h-8 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center hover:scale-110 transition-transform">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <label className="flex flex-col items-center justify-center aspect-video border-2 border-dashed border-indigo-500/30 bg-indigo-50/30 rounded-xl cursor-pointer hover:bg-indigo-50 transition-colors">
                                                    <Upload size={20} className="text-indigo-500 mb-2" />
                                                    <span className="text-xs font-bold text-indigo-600">Upload Video (MP4)</span>
                                                    <input type="file" accept="video/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'video'); if (url) await patchAndSave({ hero_video_url: url }) } }} className="sr-only" />
                                                </label>
                                            )}
                                        </div>
                                    </div>
                                    <UrlField label="Have external media links? Paste URL here:" value="" placeholder="https://..." onSave={(v) => {
                                        if (v) {
                                            const isVid = v.match(/\.(mp4|webm|mov)(\?.*)?$/i);
                                            patchAndSave(isVid ? { hero_video_url: v } : { hero_image_url: v });
                                        }
                                    }} />
                                </div>
                            )}

                            {/* --- 5. About --- */}
                            {activeTab === 'about' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">About Us</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Tell your story to build a connection with your guests.</p>
                                    </div>
                                    
                                    <Toggle label="Enable About Section" checked={config.about?.enabled ?? true} onChange={(v) => patchAbout({ enabled: v })} />
                                    
                                    <div className={`space-y-5 transition-opacity ${!config.about?.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <TextField label="Section Title" value={config.about?.title || ''} onChange={(v) => patchAbout({ title: v })} />
                                        <TextArea label="Our Story (Description)" value={config.about?.description || ''} onChange={(v) => patchAbout({ description: v })} />
                                        
                                        <div className="pt-4">
                                            <label className="block text-[11px] font-bold text-ink uppercase tracking-wider mb-3">Chef / Restaurant Image</label>
                                            {config.about?.image_url ? (
                                                <div className="relative group inline-block">
                                                    <Image src={config.about.image_url} alt="About" width={320} height={200} className="h-48 w-auto object-cover rounded-xl border border-hairline shadow-sm" style={{ width: 'auto' }} />
                                                    <button onClick={() => patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: '' } })} className="absolute -top-3 -right-3 w-8 h-8 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center shadow-md border-2 border-white hover:scale-110 transition-transform">
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <label className="flex items-center gap-3 px-6 py-4 border-2 border-dashed border-brand-500/30 bg-brand-50/30 rounded-xl cursor-pointer hover:bg-brand-50 transition-all w-fit">
                                                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600">
                                                        <Upload size={18} />
                                                    </div>
                                                    <span className="text-sm font-bold text-brand-700">Upload Image</span>
                                                    <input type="file" accept="image/*" onChange={async (e) => { if (e.target.files?.[0]) { const url = await uploadFile(e.target.files[0], 'image'); if (url) await patchAndSave({ about: { ...DEFAULT_CONFIG.about!, ...config.about, image_url: url } }) } }} className="sr-only" />
                                                </label>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* --- 6. Features --- */}
                            {activeTab === 'features' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-h3 font-black text-ink mb-1">Highlights</h3>
                                            <p className="text-sm font-medium text-ink-subtle">List key selling points (e.g. Free Wi-Fi, Vegan Options, Live Music).</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => patch({ features: [...features, { title: 'New Highlight', description: 'Description here' }] })}
                                            className="flex items-center gap-2 text-sm font-bold text-white bg-ink hover:bg-ink/90 py-2.5 px-4 rounded-full transition-colors shadow-md active:scale-95"
                                        >
                                            <Plus size={16} /> Add Item
                                        </button>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {features.map((f, idx) => (
                                            <div key={idx} className="p-5 border border-hairline bg-surface-muted/30 rounded-[var(--r-lg)] space-y-4 relative group hover:border-brand-200 transition-colors shadow-sm">
                                                <button
                                                    type="button"
                                                    onClick={() => patch({ features: features.filter((_, i) => i !== idx) })}
                                                    className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center bg-surface border border-hairline text-ink-subtle hover:text-danger-fg hover:border-danger-fg/30 shadow-sm transition-all"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                                <div className="pr-8 space-y-3">
                                                    <TextField label={`Highlight ${idx + 1}`} value={f.title} onChange={(v) => patch({ features: features.map((it, i) => (i === idx ? { ...it, title: v } : it)) })} />
                                                    <TextArea label="Short Description" value={f.description} onChange={(v) => patch({ features: features.map((it, i) => (i === idx ? { ...it, description: v } : it)) })} />
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    {features.length === 0 && (
                                        <div className="p-12 text-center border-2 border-dashed border-hairline rounded-[var(--r-lg)] text-ink-subtle">
                                            No highlights added yet. Click &quot;Add Item&quot; to start.
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* --- 7. CTA --- */}
                            {activeTab === 'cta' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Action Banner</h3>
                                        <p className="text-sm font-medium text-ink-subtle">A prominent banner placed mid-page to drive conversions (ordering or booking).</p>
                                    </div>
                                    
                                    <Toggle label="Enable Action Banner" checked={config.cta?.enabled ?? true} onChange={(v) => patchCta({ enabled: v })} />
                                    
                                    <div className={`p-6 bg-brand-50/30 border border-brand-100 rounded-[var(--r-lg)] space-y-5 transition-opacity ${!config.cta?.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <TextField label="Headline" value={config.cta?.headline || ''} onChange={(v) => patchCta({ headline: v })} placeholder="Ready to order?" />
                                        <TextField label="Subtext" value={config.cta?.description || ''} onChange={(v) => patchCta({ description: v })} placeholder="Fresh food delivered fast." />
                                        <TextField label="Button Text" value={config.cta?.button_text || ''} onChange={(v) => patchCta({ button_text: v })} placeholder="Order Now" />
                                    </div>
                                </div>
                            )}

                            {/* --- 8. Gallery --- */}
                            {activeTab === 'gallery' && (
                                <div className="space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <h3 className="text-h3 font-black text-ink mb-1">Visual Gallery</h3>
                                            <p className="text-sm font-medium text-ink-subtle">Show off your best dishes and interior.</p>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm font-bold text-white bg-ink hover:bg-ink/90 py-2.5 px-4 rounded-full cursor-pointer transition-colors shadow-md active:scale-95">
                                            <Upload size={16} /> Upload Media
                                            <input type="file" accept="image/*,video/*" multiple onChange={async (e) => { 
                                                if (e.target.files && e.target.files.length > 0) { 
                                                    const files = Array.from(e.target.files);
                                                    const uploadPromises = files.map(async (file) => {
                                                        const type = file.type.startsWith('video/') ? 'video' : 'image';
                                                        const url = await uploadFile(file, type);
                                                        return url ? { image_url: url, caption: '', media_type: type as 'image' | 'video' } : null;
                                                    });
                                                    const newItems = (await Promise.all(uploadPromises)).filter((item) => item !== null);
                                                    if (newItems.length > 0) {
                                                        await patchAndSave({ gallery: [...gallery, ...newItems] });
                                                    }
                                                } 
                                            }} className="sr-only" />
                                        </label>
                                    </div>
                                    
                                    {gallery.length > 0 ? (
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                            {gallery.map((g, idx) => (
                                                <div key={idx} className="bg-surface p-2 rounded-xl border border-hairline shadow-sm group">
                                                    <div className="relative aspect-square rounded-lg overflow-hidden mb-2 bg-surface-muted">
                                                        {g.media_type === 'video' || g.image_url.match(/\.(mp4|webm|mov)(\?.*)?$/i) ? (
                                                            <video src={g.image_url} className="w-full h-full object-cover" autoPlay muted loop playsInline />
                                                        ) : (
                                                            <Image src={g.image_url} alt={g.caption || ''} fill sizes="200px" className="object-cover" />
                                                        )}
                                                        <button type="button" onClick={() => patchAndSave({ gallery: gallery.filter((_, i) => i !== idx) })} className="absolute top-2 right-2 w-7 h-7 bg-danger-bg text-danger-fg rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md">
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                    <input
                                                        type="text"
                                                        value={g.caption || ''}
                                                        placeholder="Add caption..."
                                                        onChange={(e) => patch({ gallery: gallery.map((it, i) => (i === idx ? { ...it, caption: e.target.value } : it)) })}
                                                        className="w-full px-2 py-1.5 text-xs font-bold text-ink bg-transparent border-none focus:ring-2 focus:ring-brand-500/20 rounded placeholder:text-ink-muted/50"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="p-16 text-center border-2 border-dashed border-hairline rounded-[var(--r-lg)] flex flex-col items-center justify-center">
                                            <div className="w-16 h-16 bg-surface-muted rounded-full flex items-center justify-center text-ink-subtle mb-4">
                                                <ImageIcon size={32} className="opacity-50" />
                                            </div>
                                            <p className="text-ink-subtle font-medium">Your gallery is empty. Upload some delicious photos!</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* --- 9. Contact --- */}
                            {activeTab === 'contact' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Location & Contact</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Help customers find and reach you easily.</p>
                                    </div>
                                    
                                    <Toggle label="Enable Contact Section" checked={config.contact?.enabled ?? true} onChange={(v) => patchContact({ enabled: v })} />
                                    
                                    <div className={`space-y-5 transition-opacity ${!config.contact?.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                            <TextField label="Phone Number" value={config.contact?.phone || ''} onChange={(v) => patchContact({ phone: v })} placeholder="+1 234 567 890" />
                                            <TextField label="Email Address" value={config.contact?.email || ''} onChange={(v) => patchContact({ email: v })} placeholder="hello@restaurant.com" />
                                        </div>
                                        <TextField label="Physical Address" value={config.contact?.map_address || ''} onChange={(v) => patchContact({ map_address: v })} placeholder="123 Culinary Ave, Food City" />
                                        <p className="text-xs text-ink-subtle -mt-2">A map is generated automatically from this address — no embed code needed.</p>

                                        <TextField label="Google Reviews Link" value={config.contact?.review_link || ''} onChange={(v) => patchContact({ review_link: v })} placeholder="https://g.page/r/..." />
                                    </div>
                                </div>
                            )}

                            {/* --- 10. Footer & Social --- */}
                            {activeTab === 'footer' && (
                                <div className="space-y-6">
                                    <div>
                                        <h3 className="text-h3 font-black text-ink mb-2">Footer & Social Media</h3>
                                        <p className="text-sm font-medium text-ink-subtle">Connect your socials and configure the page footer.</p>
                                    </div>
                                    
                                    <div className="p-6 bg-surface-muted/30 border border-hairline rounded-[var(--r-lg)] space-y-5">
                                        <h4 className="text-sm font-extrabold text-ink uppercase tracking-wider mb-2">Social Links</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                                            <TextField label="Instagram URL" value={config.social?.instagram || ''} onChange={(v) => patchSocial({ instagram: v })} placeholder="https://instagram.com/..." />
                                            <TextField label="Facebook URL" value={config.social?.facebook || ''} onChange={(v) => patchSocial({ facebook: v })} placeholder="https://facebook.com/..." />
                                            <TextField label="TikTok URL" value={config.social?.tiktok || ''} onChange={(v) => patchSocial({ tiktok: v })} placeholder="https://tiktok.com/@..." />
                                            <TextField label="WhatsApp Number" value={config.social?.whatsapp || ''} onChange={(v) => patchSocial({ whatsapp: v })} placeholder="+1234567890" />
                                        </div>
                                    </div>

                                    <div className="p-6 border border-hairline rounded-[var(--r-lg)] space-y-5">
                                        <Toggle label="Enable Footer" checked={config.footer?.enabled ?? true} onChange={(v) => patchFooter({ enabled: v })} />
                                        <div className={`transition-opacity ${!config.footer?.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                                            <TextField label="Copyright Text" value={config.footer?.copyright || ''} onChange={(v) => patchFooter({ copyright: v })} />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    </AnimatePresence>
                </div>

                {/* Footer Navigation Controls */}
                <div className="mt-6 flex items-center justify-between bg-surface p-4 rounded-xl border border-hairline shadow-sm">
                    <button
                        type="button"
                        onClick={handlePrev}
                        disabled={currentStepIndex === 0}
                        className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-ink-subtle hover:text-ink disabled:opacity-30 transition-colors focus-ring rounded-lg"
                    >
                        <ChevronLeft size={16} /> Previous
                    </button>
                    
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-ink-muted">
                            {isSaving ? <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Saving...</span> : 'Saved'}
                        </span>
                        <button
                            type="button"
                            onClick={handleNext}
                            className="flex items-center gap-2 px-6 py-2.5 bg-brand-500 text-white text-sm font-bold rounded-lg hover:bg-brand-600 transition-all shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:-translate-y-0.5 active:translate-y-0 focus-ring"
                        >
                            {currentStepIndex === STEPS.length - 1 ? 'Finish' : 'Next Step'} <ChevronRight size={16} />
                        </button>
                    </div>
                </div>

            </div>

            {/* RIGHT: Live Preview Panel */}
            <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0">
                <div className="sticky top-6 bg-surface rounded-[2rem] border-8 border-ink/5 overflow-hidden shadow-2xl flex flex-col" style={{ height: 'calc(100vh - 48px)', maxHeight: 850 }}>
                    {/* Fake Browser/Phone Header */}
                    <div className="px-4 py-3 bg-surface-muted/80 backdrop-blur-md flex items-center gap-4 shrink-0 border-b border-hairline z-10">
                        <div className="flex gap-1.5">
                            <div className="w-3 h-3 rounded-full bg-rose-400"></div>
                            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
                            <div className="w-3 h-3 rounded-full bg-emerald-400"></div>
                        </div>
                        <div className="flex-1 bg-surface/50 border border-hairline rounded-full h-7 flex items-center justify-center text-[10px] font-bold text-ink-subtle tracking-wide font-mono">
                            Preview
                        </div>
                        <button onClick={() => setIsPreviewOpen(true)} className="text-brand-500 hover:text-brand-600 transition-colors p-1" title="Full Screen">
                            <Eye size={16} />
                        </button>
                    </div>
                    
                    {/* Scaled Preview Frame */}
                    <div className="flex-1 relative bg-canvas overflow-y-auto overflow-x-hidden w-full custom-scrollbar pointer-events-none select-none">
                        {/* We use scale to fit a 375px mobile view into whatever width is available, 
                            or we just let it be responsive. Since the container is ~400px, responsive is actually perfect for mobile preview! */}
                        <div className="w-full min-h-full">
                            <HomepageRenderer config={config} onMenuClick={() => {}} />
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
