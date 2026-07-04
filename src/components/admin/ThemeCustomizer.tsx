'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import Image from 'next/image'
import { Save, Type, Palette, Image as ImageIcon, Upload, X, RefreshCw, ExternalLink, Smartphone } from 'lucide-react'
import type { Settings } from '@/types/database'
import { toast } from 'react-hot-toast'
import { updateThemeAction, updateBrandingAction } from '@/app/(admin)/admin/theme/actions'

// Mirror the font/radius mapping used by the root layout (src/app/layout.tsx)
// so the live preview matches exactly what customers will see once published.
const FONT_MAP: Record<string, string> = {
    Inter: 'var(--font-inter), sans-serif',
    Playfair: 'var(--font-playfair), serif',
    Roboto: 'var(--font-roboto), sans-serif',
    Lato: 'var(--font-lato), sans-serif',
}

const RADIUS_MAP: Record<string, string> = {
    none: '0px', sm: '4px', md: '8px', lg: '12px', xl: '20px', full: '9999px',
}

function resolveRadius(val: string | undefined): string {
    if (!val) return RADIUS_MAP.lg
    if (RADIUS_MAP[val]) return RADIUS_MAP[val]
    if (/^\d+(\.\d+)?(px|rem|em)$/.test(val)) return val
    return RADIUS_MAP.lg
}

function themeToCSS(theme: Partial<Settings['theme']> = {}): string {
    return `:root {
        --color-primary: ${theme.primaryColor || '#FB6303'};
        --color-secondary: ${theme.secondaryColor || '#1B263B'};
        --color-accent: ${theme.accentColor || '#EC4899'};
        --font-family: ${FONT_MAP[theme.fontFamily || 'Inter'] || FONT_MAP.Inter};
        --border-radius: ${resolveRadius(theme.borderRadius)};
    }`
}

export default function ThemeCustomizer({
    initialSettings,
    restaurantSlug = null,
    initialLogoUrl = null,
}: {
    initialSettings: Partial<Settings>
    restaurantName?: string
    restaurantSlug?: string | null
    initialLogoUrl?: string | null
}) {
    const [settings, setSettings] = useState(initialSettings)
    const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)
    const [isSaving, setIsSaving] = useState(false)
    const [isUploading, setIsUploading] = useState(false)

    const iframeRef = useRef<HTMLIFrameElement>(null)
    const [previewLoading, setPreviewLoading] = useState(true)
    const [previewKey, setPreviewKey] = useState(0)
    const previewUrl = restaurantSlug ? `/takeout/${restaurantSlug}` : null

    // Inject (or update) a <style> override inside the same-origin preview iframe
    // so colour/font/radius tweaks render instantly — before the admin publishes.
    const applyPreviewOverride = useCallback(() => {
        const doc = iframeRef.current?.contentDocument
        if (!doc?.head) return
        let style = doc.getElementById('__theme_preview_override') as HTMLStyleElement | null
        if (!style) {
            style = doc.createElement('style')
            style.id = '__theme_preview_override'
            doc.head.appendChild(style)
        }
        // Appended last in <head>, so it wins over the layout's :root rule.
        style.textContent = themeToCSS(settings.theme)
    }, [settings.theme])

    // Re-apply whenever the theme changes or the iframe reloads.
    useEffect(() => {
        applyPreviewOverride()
    }, [applyPreviewOverride, previewKey])

    const handleSave = async () => {
        if (!settings.id || !settings.theme) return
        setIsSaving(true)
        const result = await updateThemeAction(settings.id, settings.theme as Record<string, string>)
        setIsSaving(false)
        if (!result.error) {
            toast.success('Theme saved — changes are now live.')
            // Reload the preview so server-rendered structural changes (e.g. menu
            // layout) reflect the freshly published settings, not just the overlay.
            setPreviewLoading(true)
            setPreviewKey((k) => k + 1)
        } else {
            toast.error('Failed to save: ' + result.error)
        }
    }

    const handleLogoUpload = async (file: File) => {
        setIsUploading(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('type', 'image')
            formData.append('folder', 'branding')
            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error || 'Upload failed')
                return
            }
            const result = await updateBrandingAction(data.url)
            if (result.error) {
                toast.error('Failed to save logo: ' + result.error)
                return
            }
            setLogoUrl(data.url)
            toast.success('Logo updated — now live.')
        } catch {
            toast.error('Network error during upload')
        } finally {
            setIsUploading(false)
        }
    }

    const handleLogoRemove = async () => {
        const result = await updateBrandingAction(null)
        if (result.error) {
            toast.error('Failed to remove logo: ' + result.error)
            return
        }
        setLogoUrl(null)
        toast.success('Logo removed.')
    }

    const updateTheme = (key: string, value: string) => {
        setSettings((prev: Partial<Settings>) => ({
            ...prev,
            theme: {
                ...prev.theme,
                primaryColor: prev.theme?.primaryColor || '',
                secondaryColor: prev.theme?.secondaryColor || '',
                accentColor: prev.theme?.accentColor || '',
                fontFamily: prev.theme?.fontFamily || '',
                borderRadius: prev.theme?.borderRadius || '',
                menuLayout: prev.theme?.menuLayout || '',
                [key]: value
            }
        }))
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-surface p-6 rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                <div>
                    <h1 className="text-h1 font-extrabold text-ink tracking-tight">Brand & Theme</h1>
                    <p className="text-sm font-medium text-ink-subtle mt-1 max-w-2xl">Configure the look and feel of your customer-facing ordering app.</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-3 rounded-[var(--r-md)] font-bold flex items-center gap-2 shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 focus-ring"
                >
                    <Save size={18} />
                    {isSaving ? 'Saving...' : 'Publish Changes'}
                </button>
            </div>

            {/* Logo */}
            <div className="bg-surface p-6 rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] space-y-5">
                <div className="flex items-center gap-3 border-b border-hairline pb-4">
                    <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-500">
                        <ImageIcon size={16} />
                    </div>
                    <h2 className="text-h3 font-extrabold text-ink">Brand Logo</h2>
                </div>
                <div className="flex items-center gap-6">
                    <div className="w-28 h-28 rounded-[var(--r-md)] border border-hairline bg-surface-muted/30 flex items-center justify-center overflow-hidden shrink-0 shadow-sm relative">
                        {logoUrl ? (
                            <Image src={logoUrl} alt="Logo" width={96} height={96} className="w-full h-full object-contain p-3" />
                        ) : (
                            <ImageIcon className="text-ink-muted/50" size={32} />
                        )}
                    </div>
                    <div className="flex flex-col gap-3">
                        <label className="flex items-center gap-2 px-5 py-3 border-2 border-dashed border-brand-500/30 bg-brand-50/50 rounded-[var(--r-md)] cursor-pointer hover:border-brand-500 hover:bg-brand-50 transition-all w-fit group">
                            <Upload size={16} className="text-brand-500 group-hover:-translate-y-0.5 transition-transform" />
                            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{isUploading ? 'Uploading…' : logoUrl ? 'Replace Logo' : 'Upload Logo'}</span>
                            <input
                                type="file"
                                accept="image/*"
                                disabled={isUploading}
                                onChange={(e) => { if (e.target.files?.[0]) handleLogoUpload(e.target.files[0]) }}
                                className="sr-only"
                            />
                        </label>
                        {logoUrl && (
                            <button onClick={handleLogoRemove} className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-danger-fg bg-danger-bg/50 px-3 py-1.5 rounded-[var(--r-md)] hover:bg-danger-bg transition-colors w-fit focus-ring">
                                <X size={14} /> Remove
                            </button>
                        )}
                        <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Shown in your customer ordering app header. PNG with transparent background recommended.</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Colors */}
                <div className="bg-surface p-6 rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] space-y-6">
                    <div className="flex items-center gap-3 border-b border-hairline pb-4">
                        <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-500">
                            <Palette size={16} />
                        </div>
                        <h2 className="text-h3 font-extrabold text-ink">Color Palette</h2>
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        {([
                            { key: 'primaryColor',   label: 'Primary Color',   def: '#FB6303' },
                            { key: 'secondaryColor', label: 'Secondary Color', def: '#1B263B' },
                            { key: 'accentColor',    label: 'Accent Color',    def: '#EC4899' },
                        ] as const).map(({ key, label, def }) => {
                            const val = settings.theme?.[key] || def
                            return (
                                <div key={key}>
                                    <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">{label}</label>
                                    <div className="flex items-center gap-3">
                                        {/* Colored swatch — click opens native color picker */}
                                        <label
                                            className="relative w-10 h-10 rounded-xl border border-hairline shadow-sm cursor-pointer shrink-0"
                                            style={{ backgroundColor: val }}
                                        >
                                            <input
                                                type="color"
                                                value={val}
                                                onChange={(e) => updateTheme(key, e.target.value)}
                                                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                            />
                                        </label>
                                        <input
                                            type="text"
                                            value={val}
                                            maxLength={7}
                                            onChange={(e) => {
                                                const v = e.target.value
                                                if (/^#[0-9a-fA-F]{0,6}$/.test(v)) updateTheme(key, v)
                                            }}
                                            className="w-28 px-3 py-2 text-sm font-bold text-ink font-mono bg-surface border border-hairline rounded-[var(--r-md)] focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all uppercase"
                                            placeholder="#000000"
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Typography */}
                <div className="bg-surface p-6 rounded-card border border-hairline shadow-[0_8px_24px_rgba(0,0,0,0.04)] space-y-6">
                    <div className="flex items-center gap-3 border-b border-hairline pb-4">
                        <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand-500">
                            <Type size={16} />
                        </div>
                        <h2 className="text-h3 font-extrabold text-ink">Typography & Radius</h2>
                    </div>

                    <div className="space-y-5">
                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Heading Font Family</label>
                            <select
                                value={settings.theme?.fontFamily || "Inter"}
                                onChange={(e) => updateTheme('fontFamily', e.target.value)}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-3 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all cursor-pointer"
                            >
                                <option value="Playfair">Playfair Display (Elegant)</option>
                                <option value="Inter">Inter (Modern Clean)</option>
                                <option value="Roboto">Roboto (Geometric)</option>
                                <option value="Lato">Lato (Tech)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Border Radius (px)</label>
                            <input
                                type="range"
                                min="0" max="32"
                                value={isNaN(parseInt(settings.theme?.borderRadius || '12')) ? 12 : parseInt(settings.theme?.borderRadius || '12')}
                                onChange={(e) => updateTheme('borderRadius', `${e.target.value}px`)}
                                className="w-full accent-brand-500 h-1.5 bg-surface-muted rounded-lg appearance-none cursor-pointer"
                            />
                            <div className="text-right text-[11px] font-bold text-ink-muted font-mono mt-2 uppercase tracking-wider">
                                {settings.theme?.borderRadius || '12px'}
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Menu Layout</label>
                            <select
                                value={settings.theme?.menuLayout || 'grid'}
                                onChange={(e) => updateTheme('menuLayout', e.target.value)}
                                className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink p-3 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all cursor-pointer"
                            >
                                <option value="grid">Grid (cards side by side)</option>
                                <option value="list">List (full-width rows)</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {/* Live Preview Embed */}
            <div className="flex flex-col md:flex-row md:items-center justify-between mt-8 mb-6 gap-4">
                <div>
                    <h3 className="text-h3 font-extrabold text-ink flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-brand-50 flex items-center justify-center text-brand-500">
                            <Smartphone size={14} />
                        </div>
                        Live Customer App Preview
                    </h3>
                    <p className="text-sm font-medium text-ink-subtle mt-1 max-w-2xl">
                        Colors, fonts and corners update instantly. Click <strong className="text-ink">Publish Changes</strong> to make them live for customers.
                    </p>
                </div>
                {previewUrl && (
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => { setPreviewLoading(true); setPreviewKey((k) => k + 1) }}
                            className="flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-ink bg-surface border border-hairline rounded-[var(--r-md)] hover:bg-surface-muted transition-colors shadow-sm focus-ring"
                        >
                            <RefreshCw size={14} /> Refresh
                        </button>
                        <a
                            href={previewUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-brand-600 bg-brand-50 border border-brand-500/20 rounded-[var(--r-md)] hover:bg-brand-100 transition-colors shadow-sm focus-ring"
                        >
                            <ExternalLink size={14} /> Open
                        </a>
                    </div>
                )}
            </div>
            <div className="bg-surface-muted/50 p-6 rounded-card border border-hairline flex justify-center">
                {previewUrl ? (
                    <div className="w-[375px] h-[750px] bg-surface rounded-[40px] overflow-hidden shadow-[0_24px_48px_rgba(0,0,0,0.1)] border-8 border-ink relative">
                        {previewLoading && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface/90 backdrop-blur-sm">
                                <RefreshCw size={28} className="text-brand-500 animate-spin" />
                                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-subtle">Loading preview…</span>
                            </div>
                        )}
                        <iframe
                            key={previewKey}
                            ref={iframeRef}
                            src={previewUrl}
                            title="Live customer app preview"
                            className="w-full h-full border-0"
                            onLoad={() => { setPreviewLoading(false); applyPreviewOverride() }}
                        />
                    </div>
                ) : (
                    <div className="w-[375px] h-[750px] bg-surface rounded-[40px] shadow-[0_24px_48px_rgba(0,0,0,0.1)] border-8 border-ink flex flex-col items-center justify-center text-center p-8 gap-4">
                        <div className="w-16 h-16 rounded-full bg-surface-muted flex items-center justify-center text-ink-muted">
                            <Smartphone size={32} />
                        </div>
                        <p className="text-sm font-medium text-ink-subtle">
                            Live preview unavailable — this restaurant doesn’t have a public URL configured yet.
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}
