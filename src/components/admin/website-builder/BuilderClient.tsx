'use client'

import { useState } from 'react'
import {
    Monitor,
    Tablet,
    Smartphone,
    LayoutTemplate,
    ExternalLink,
    Save,
    Image as ImageIcon,
    Star,
    Clock,
    MapPin,
    Phone,
    HelpCircle,
    Megaphone,
    Palette,
    Type,
    Square,
    PlayCircle,
    Minus,
    Layers,
    Menu as MenuIcon,
    Search,
    Globe,
    Layout,
    Utensils,
    Sparkles,
    BarChart,
    ChevronDown,
    Copy,
    QrCode,
    X,
    Plus,
    GripVertical,
    FileText,
    ArrowLeft,
    Trash2,
    Settings,
    Eye
} from 'lucide-react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

const availableSections = [
    { id: 'hero', name: 'Hero Section', desc: 'Full-width banner with your name, tagline and a call-to-action', icon: Layout },
    { id: 'menu', name: 'Menu', desc: 'Live menu from your POS with categories, photos and prices', icon: Utensils },
    { id: 'specials', name: 'Specials / Featured Dishes', desc: 'Spotlight featured or seasonal dishes', icon: Sparkles },
    { id: 'about', name: 'About Us', desc: 'Tell your story with text and a photo', icon: MenuIcon },
    { id: 'stats', name: 'Stats & Numbers', desc: 'Eye-catching numbers - covers served, years open, rating', icon: BarChart },
    { id: 'gallery', name: 'Gallery', desc: 'A photo grid of your food and space', icon: ImageIcon },
    { id: 'reviews', name: 'Guest Reviews', desc: 'Show off your best guest ratings', icon: Star },
    { id: 'hours', name: 'Opening Hours', desc: 'Opening hours, auto-synced from settings', icon: Clock },
    { id: 'location', name: 'Location & Map', desc: 'Your address with an embedded map', icon: MapPin },
    { id: 'contact', name: 'Contact', desc: 'Phone, email and a message prompt', icon: Phone },
    { id: 'faq', name: 'FAQ', desc: 'Answer the questions guests ask most', icon: HelpCircle },
    { id: 'cta', name: 'Call to Action Banner', desc: 'A bold banner prompting reservations or orders', icon: Megaphone },
]

export default function BuilderClient() {
    const [deviceMode, setDeviceMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
    const [theme, setTheme] = useState<'light' | 'warm' | 'dark'>('warm')
    const [bgPattern, setBgPattern] = useState('none')
    const [isOffline, setIsOffline] = useState(false)
    const [urlSlug, setUrlSlug] = useState('account')
    
    // Advanced state
    const [leftTab, setLeftTab] = useState<'layout' | 'add'>('layout')
    const [activeSections, setActiveSections] = useState([
        { id: '1', type: 'hero', name: 'Hero Section', content: { title: 'Welcome to The House' } },
        { id: '2', type: 'menu', name: 'Main Menu' },
    ])
    const [editingSection, setEditingSection] = useState<string | null>(null)
    const [expandedRightPanel, setExpandedRightPanel] = useState<string | null>('theme')

    const addSection = (sectionType: string, name: string) => {
        const newSection = { id: Math.random().toString(36).substr(2, 9), type: sectionType, name }
        setActiveSections([...activeSections, newSection])
        setLeftTab('layout')
        setEditingSection(newSection.id)
    }

    const removeSection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation()
        setActiveSections(activeSections.filter(s => s.id !== id))
        if (editingSection === id) setEditingSection(null)
    }

    const toggleRightPanel = (panel: string) => {
        setExpandedRightPanel(expandedRightPanel === panel ? null : panel)
    }

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
                            <p className="text-xs text-ink-muted leading-tight">Draft · /site/{urlSlug}</p>
                        </div>
                    </div>
                    
                    <div className="h-6 w-px bg-hairline mx-2 hidden md:block"></div>
                    
                    {/* Page Selector */}
                    <button className="hidden md:flex items-center gap-2 px-3 py-1.5 hover:bg-surface-muted rounded-lg transition-colors border border-transparent hover:border-hairline">
                        <FileText className="w-4 h-4 text-ink-muted" />
                        <div className="text-left">
                            <div className="text-xs text-ink-muted leading-none mb-0.5">Current Page</div>
                            <div className="text-sm font-medium text-ink leading-none flex items-center gap-1">Home <ChevronDown className="w-3 h-3" /></div>
                        </div>
                    </button>
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
                    <span className="hidden md:flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-full border border-amber-200">
                        <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div>
                        Unsaved Changes
                    </span>
                    <button className="hidden md:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-surface border border-hairline hover:bg-surface-muted rounded-full transition-colors">
                        <Settings className="w-3.5 h-3.5" /> Settings
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-surface border border-hairline hover:bg-surface-muted rounded-full transition-colors">
                        <Eye className="w-3.5 h-3.5" /> Preview
                    </button>
                    <button className="flex items-center gap-1.5 px-5 py-1.5 text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-full transition-colors shadow-sm">
                        <Save className="w-4 h-4" /> Publish
                    </button>
                </div>
            </div>

            {/* Main Builder Area */}
            <div className="flex flex-1 overflow-hidden relative">
                {/* Left Sidebar */}
                <div className="w-72 bg-surface border-r border-hairline flex flex-col shrink-0 shadow-[4px_0_15px_-3px_rgba(0,0,0,0.02)] z-10">
                    {!editingSection ? (
                        <>
                            <div className="p-4 border-b border-hairline shrink-0">
                                <div className="flex bg-surface-muted rounded-lg p-1 border border-hairline">
                                    <button 
                                        onClick={() => setLeftTab('layout')}
                                        className={cn("flex-1 text-xs font-medium py-1.5 rounded-md transition-colors", leftTab === 'layout' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
                                    >
                                        Page Layout
                                    </button>
                                    <button 
                                        onClick={() => setLeftTab('add')}
                                        className={cn("flex-1 text-xs font-medium py-1.5 rounded-md transition-colors", leftTab === 'add' ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
                                    >
                                        Add Section
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
                                {leftTab === 'add' ? (
                                    <div className="space-y-1">
                                        {availableSections.map((section) => (
                                            <div 
                                                key={section.id} 
                                                onClick={() => addSection(section.id, section.name)}
                                                className="group flex items-start gap-3 p-3 hover:bg-brand-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-brand-100"
                                            >
                                                <div className="mt-0.5 text-brand-500 shrink-0 bg-white p-1.5 rounded-md shadow-sm border border-brand-100">
                                                    <section.icon className="w-4 h-4" />
                                                </div>
                                                <div className="flex-1 min-w-0 pt-0.5">
                                                    <h3 className="text-sm font-semibold text-ink group-hover:text-brand-700">{section.name}</h3>
                                                    <p className="text-xs text-ink-muted mt-0.5 line-clamp-2 leading-relaxed">{section.desc}</p>
                                                </div>
                                                <button className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-brand-600 hover:bg-brand-100 rounded mt-0.5">
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="space-y-2 p-2">
                                        {activeSections.length === 0 ? (
                                            <div className="text-center p-6 bg-surface-muted rounded-lg border border-dashed border-hairline mt-4">
                                                <LayoutTemplate className="w-8 h-8 text-ink-muted mx-auto mb-2" />
                                                <p className="text-sm text-ink font-medium">No sections yet</p>
                                                <p className="text-xs text-ink-muted mt-1 mb-4">Start building your page</p>
                                                <button onClick={() => setLeftTab('add')} className="text-xs font-medium text-white bg-brand-500 px-4 py-2 rounded-lg">Add Section</button>
                                            </div>
                                        ) : (
                                            activeSections.map((section, idx) => {
                                                const meta = availableSections.find(s => s.id === section.type)
                                                const Icon = meta?.icon || Layout
                                                return (
                                                    <div 
                                                        key={section.id} 
                                                        onClick={() => setEditingSection(section.id)}
                                                        className="group flex items-center justify-between p-3 bg-white border border-hairline hover:border-brand-300 rounded-lg cursor-pointer shadow-sm transition-all hover:shadow-md"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className="cursor-grab text-ink-muted hover:text-ink">
                                                                <GripVertical className="w-4 h-4" />
                                                            </div>
                                                            <div className="text-ink bg-surface-muted p-1.5 rounded-md">
                                                                <Icon className="w-4 h-4" />
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-semibold text-ink">{section.name}</div>
                                                                <div className="text-[10px] text-ink-muted uppercase tracking-wider font-semibold mt-0.5">Section {idx + 1}</div>
                                                            </div>
                                                        </div>
                                                        <button 
                                                            onClick={(e) => removeSection(section.id, e)}
                                                            className="opacity-0 group-hover:opacity-100 p-1.5 text-red-500 hover:bg-red-50 rounded transition-all"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                )
                                            })
                                        )}
                                        {activeSections.length > 0 && (
                                            <button onClick={() => setLeftTab('add')} className="w-full flex items-center justify-center gap-2 p-3 mt-4 border border-dashed border-hairline rounded-lg text-sm font-medium text-ink-muted hover:text-ink hover:bg-surface-muted hover:border-solid transition-all">
                                                <Plus className="w-4 h-4" /> Add Section
                                            </button>
                                        )}
                                    </div>
                                )}
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
                                    <p className="text-xs text-ink-muted">{activeSections.find(s => s.id === editingSection)?.name}</p>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 space-y-6">
                                <div>
                                    <label className="block text-xs font-semibold text-ink mb-2">Section Name</label>
                                    <input type="text" defaultValue={activeSections.find(s => s.id === editingSection)?.name} className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                                </div>
                                <div className="border-t border-hairline pt-6 space-y-4">
                                    <h3 className="text-xs font-semibold text-ink uppercase tracking-wider">Content Content</h3>
                                    <div>
                                        <label className="block text-xs font-medium text-ink-muted mb-1.5">Headline</label>
                                        <input type="text" placeholder="Enter headline" className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-ink-muted mb-1.5">Subheading</label>
                                        <textarea rows={3} placeholder="Enter subheading text" className="w-full px-3 py-2 text-sm border border-hairline rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-ink-muted mb-1.5">Background Image</label>
                                        <div className="border-2 border-dashed border-hairline rounded-xl p-6 flex flex-col items-center justify-center bg-surface-muted hover:bg-surface transition-colors cursor-pointer">
                                            <ImageIcon className="w-6 h-6 text-ink-muted mb-2" />
                                            <span className="text-sm font-medium text-ink">Upload Image</span>
                                            <span className="text-xs text-ink-muted mt-1">PNG, JPG up to 5MB</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Preview Canvas */}
                <div className="flex-1 bg-[url('/grid-pattern.svg')] bg-[length:24px_24px] bg-canvas overflow-y-auto relative p-4 md:p-8 flex items-start justify-center transition-all duration-300">
                    <div 
                        className={cn(
                            "bg-black rounded-lg shadow-2xl transition-all duration-500 ease-in-out relative overflow-y-auto ring-1 ring-black/10 origin-top",
                            deviceMode === 'desktop' ? 'w-full max-w-5xl min-h-full' :
                            deviceMode === 'tablet' ? 'w-[768px] min-h-[1024px]' :
                            'w-[375px] min-h-[812px]'
                        )}
                        style={{
                            backgroundColor: theme === 'light' ? '#ffffff' : theme === 'warm' ? '#fcf9f2' : '#0f172a',
                            backgroundImage: bgPattern === 'dots' ? 'radial-gradient(rgba(0,0,0,0.1) 1px, transparent 1px)' : 
                                            bgPattern === 'grid' ? 'linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)' : 'none',
                            backgroundSize: bgPattern === 'dots' ? '20px 20px' : '40px 40px',
                            color: theme === 'dark' ? '#f8fafc' : '#0f172a'
                        }}
                    >
                        {/* Fake Content for preview */}
                        <div className="sticky top-0 z-50 backdrop-blur-md bg-inherit/80 border-b border-black/5 px-6 py-4 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full border-2 border-brand-500 flex items-center justify-center bg-black shrink-0">
                                    <span className="text-white text-[10px] font-bold text-center leading-none">THE<br/>HOUSE</span>
                                </div>
                                <span className="font-bold text-lg tracking-tight">{urlSlug || 'Brand'}</span>
                            </div>
                            <div className="p-2 bg-black/5 hover:bg-black/10 rounded-md cursor-pointer transition-colors">
                                <MenuIcon className="w-5 h-5" />
                            </div>
                        </div>
                        
                        <div className="w-full flex flex-col min-h-[60vh] items-center justify-center text-center px-6 py-20 relative overflow-hidden">
                            <div className="absolute inset-0 bg-gradient-to-b from-brand-500/10 to-transparent pointer-events-none"></div>
                            <div className="w-24 h-24 rounded-full border-4 border-brand-500 flex items-center justify-center mb-8 bg-black shadow-2xl relative z-10">
                                <span className="text-white text-xs font-bold text-center leading-tight">THE<br/>HOUSE<br/><span className="text-[8px] font-normal text-slate-300 opacity-80">FEEL AT HOME</span></span>
                            </div>
                            <h2 className={cn(
                                "text-5xl md:text-7xl font-extrabold tracking-tighter mb-6 relative z-10", 
                                theme === 'dark' ? 'text-white' : 'text-slate-900'
                            )}>
                                Experience <span className="text-brand-500">Excellence</span>
                            </h2>
                            <p className="max-w-xl mx-auto text-lg md:text-xl opacity-70 mb-10 relative z-10">
                                Discover a world of flavors crafted with passion and served with elegance.
                            </p>
                            <button className="px-8 py-4 bg-brand-500 text-white font-bold rounded-full text-lg shadow-lg hover:shadow-brand-500/25 hover:-translate-y-0.5 transition-all relative z-10">
                                View Menu
                            </button>
                        </div>

                        {/* Dummy Menu Section */}
                        <div className="px-6 py-16 bg-black/5">
                            <h3 className="text-3xl font-bold text-center mb-12">Featured Dishes</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                                {[1, 2, 3, 4].map(i => (
                                    <div key={i} className="flex gap-4 p-4 rounded-2xl bg-inherit shadow-sm border border-black/5 hover:shadow-md transition-shadow">
                                        <div className="w-24 h-24 rounded-xl bg-black/10 shrink-0"></div>
                                        <div className="flex-1">
                                            <div className="flex justify-between items-start mb-2">
                                                <h4 className="font-bold text-lg">Delicious Item {i}</h4>
                                                <span className="font-bold text-brand-500">$24</span>
                                            </div>
                                            <p className="text-sm opacity-70 line-clamp-2">A wonderful description of this amazing dish that will make your mouth water.</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Sidebar */}
                <div className="w-80 bg-surface border-l border-hairline flex flex-col shrink-0 z-10 shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.02)]">
                    <div className="h-16 border-b border-hairline px-5 flex flex-col justify-center shrink-0">
                        <h2 className="text-sm font-semibold text-ink">Design & settings</h2>
                        <p className="text-xs text-ink-muted">Global styles applied across your whole site</p>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {/* Public URL Card */}
                        <div className="border border-hairline rounded-xl p-5 bg-white shadow-sm space-y-5">
                            <div>
                                <label className="block text-xs font-semibold text-ink mb-1.5 uppercase tracking-wider">Public URL</label>
                                <div className="flex rounded-lg border border-hairline bg-surface overflow-hidden focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-all">
                                    <span className="px-3 flex items-center bg-surface-muted text-ink-muted text-sm border-r border-hairline font-mono font-medium">/site/</span>
                                    <input 
                                        type="text" 
                                        value={urlSlug}
                                        onChange={(e) => setUrlSlug(e.target.value)}
                                        className="flex-1 bg-transparent px-3 py-2 text-sm text-ink outline-none font-medium"
                                    />
                                </div>
                            </div>
                            
                            <div className="flex items-center justify-between p-3 bg-surface-muted rounded-lg border border-hairline cursor-pointer" onClick={() => setIsOffline(!isOffline)}>
                                <div>
                                    <div className="text-sm font-semibold text-ink">Site is offline</div>
                                    <div className="text-[11px] text-ink-muted mt-0.5">Only you can preview it</div>
                                </div>
                                <div className={cn("w-10 h-5 rounded-full transition-colors relative shadow-inner", isOffline ? "bg-brand-500" : "bg-slate-300")}>
                                    <span className={cn("absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform shadow-sm", isOffline ? "translate-x-5" : "translate-x-0")}></span>
                                </div>
                            </div>
                            
                            <div className="flex gap-2">
                                <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 border border-hairline rounded-lg text-xs font-semibold text-ink hover:bg-surface-muted transition-colors shadow-sm">
                                    <Copy className="w-3.5 h-3.5" /> Copy URL
                                </button>
                                <button className="flex-1 flex items-center justify-center gap-2 py-2 px-3 border border-brand-200 bg-brand-50 rounded-lg text-xs font-semibold text-brand-700 hover:bg-brand-100 transition-colors shadow-sm">
                                    <QrCode className="w-3.5 h-3.5" /> QR Code
                                </button>
                            </div>
                        </div>

                        {/* Visual Theme Accordion */}
                        <div className="border border-hairline rounded-xl overflow-hidden bg-white shadow-sm">
                            <button 
                                onClick={() => toggleRightPanel('theme')}
                                className="w-full flex items-center justify-between p-4 bg-white hover:bg-surface-muted transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-brand-50 text-brand-600 rounded-md">
                                        <Palette className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-semibold text-ink">Visual Theme</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2 py-1 rounded-full">{theme}</span>
                                    <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === 'theme' ? "rotate-180" : "")} />
                                </div>
                            </button>
                            
                            {expandedRightPanel === 'theme' && (
                                <div className="p-4 border-t border-hairline bg-surface/50 grid grid-cols-3 gap-3">
                                    <button onClick={() => setTheme('light')} className={cn("flex flex-col rounded-xl overflow-hidden border-2 transition-all hover:shadow-md", theme === 'light' ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-hairline hover:border-slate-300')}>
                                        <div className="h-12 bg-white"></div>
                                        <div className="h-6 bg-slate-100 border-t border-hairline"></div>
                                        <div className="py-2.5 text-xs font-bold text-center text-ink bg-white">Light</div>
                                    </button>
                                    <button onClick={() => setTheme('warm')} className={cn("flex flex-col rounded-xl overflow-hidden border-2 transition-all hover:shadow-md", theme === 'warm' ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-hairline hover:border-slate-300')}>
                                        <div className="h-12 bg-[#3a3530]"></div>
                                        <div className="h-6 bg-[#f4ebd0] border-t border-[#4a4540]"></div>
                                        <div className="py-2.5 text-xs font-bold text-center text-ink bg-white">Warm</div>
                                    </button>
                                    <button onClick={() => setTheme('dark')} className={cn("flex flex-col rounded-xl overflow-hidden border-2 transition-all hover:shadow-md", theme === 'dark' ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-hairline hover:border-slate-300')}>
                                        <div className="h-12 bg-[#0f172a]"></div>
                                        <div className="h-6 bg-[#1e293b] border-t border-[#334155]"></div>
                                        <div className="py-2.5 text-xs font-bold text-center text-ink bg-white">Dark</div>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Background Pattern Accordion */}
                        <div className="border border-hairline rounded-xl overflow-hidden bg-white shadow-sm">
                            <button 
                                onClick={() => toggleRightPanel('pattern')}
                                className="w-full flex items-center justify-between p-4 bg-white hover:bg-surface-muted transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 bg-brand-50 text-brand-600 rounded-md">
                                        <Layers className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-semibold text-ink">Background Pattern</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {bgPattern !== 'none' && <span className="w-2 h-2 rounded-full bg-brand-500"></span>}
                                    <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === 'pattern' ? "rotate-180" : "")} />
                                </div>
                            </button>
                            
                            {expandedRightPanel === 'pattern' && (
                                <div className="p-4 border-t border-hairline bg-surface/50">
                                    <p className="text-xs text-ink-muted mb-4 font-medium">Add a subtle repeating pattern to section backgrounds for a richer look.</p>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { id: 'none', label: 'None', preview: <div className="w-full h-full bg-slate-100 rounded-md"></div> },
                                            { id: 'dots', label: 'Dots', preview: <div className="w-full h-full bg-[radial-gradient(#94a3b8_1.5px,transparent_1.5px)] [background-size:8px_8px] rounded-md"></div> },
                                            { id: 'grid', label: 'Grid', preview: <div className="w-full h-full bg-[linear-gradient(#cbd5e1_1px,transparent_1px),linear-gradient(90deg,#cbd5e1_1px,transparent_1px)] [background-size:8px_8px] rounded-md"></div> },
                                        ].map((pattern) => (
                                            <button 
                                                key={pattern.id}
                                                onClick={() => setBgPattern(pattern.id)}
                                                className={cn(
                                                    "flex flex-col items-center p-2.5 rounded-xl border-2 transition-all hover:shadow-md",
                                                    bgPattern === pattern.id ? 'border-brand-500 bg-brand-50/50' : 'border-hairline hover:border-slate-300 bg-white'
                                                )}
                                            >
                                                <div className="w-full h-10 mb-2">
                                                    {pattern.preview}
                                                </div>
                                                <div className={cn("text-[11px] font-bold uppercase tracking-wider", bgPattern === pattern.id ? 'text-brand-600' : 'text-ink')}>{pattern.label}</div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Other Collapsible Settings */}
                        {[
                            { id: 'typography', icon: Type, label: 'Typography', value: 'Inter', valueColor: 'text-brand-600', valueBg: 'bg-brand-50' },
                            { id: 'colors', icon: Palette, label: 'Brand Colors', value: 'Ocean', valueColor: 'text-blue-600', valueBg: 'bg-blue-50' },
                            { id: 'corners', icon: Square, label: 'Corner Style' },
                            { id: 'seo', icon: Search, label: 'SEO Settings' },
                            { id: 'social', icon: Globe, label: 'Social Links' },
                        ].map((item) => (
                            <div key={item.id} className="border border-hairline rounded-xl overflow-hidden bg-white shadow-sm">
                                <button 
                                    onClick={() => toggleRightPanel(item.id)}
                                    className="w-full flex items-center justify-between p-4 bg-white hover:bg-surface-muted transition-colors"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="p-1.5 bg-slate-100 text-slate-600 rounded-md">
                                            <item.icon className="w-4 h-4" />
                                        </div>
                                        <span className="text-sm font-semibold text-ink">{item.label}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {item.value && (
                                            <span className={cn("text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full", item.valueColor, item.valueBg)}>
                                                {item.value}
                                            </span>
                                        )}
                                        <ChevronDown className={cn("w-4 h-4 text-ink-muted transition-transform", expandedRightPanel === item.id ? "rotate-180" : "")} />
                                    </div>
                                </button>
                                
                                {expandedRightPanel === item.id && (
                                    <div className="p-5 border-t border-hairline bg-surface/50 text-center text-sm text-ink-muted">
                                        <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                                            <Settings className="w-6 h-6 text-slate-400" />
                                        </div>
                                        <p className="font-medium text-ink mb-1">{item.label} Options</p>
                                        <p className="text-xs">Advanced configuration would appear here.</p>
                                    </div>
                                )}
                            </div>
                        ))}

                    </div>
                </div>
            </div>
        </div>
    )
}
