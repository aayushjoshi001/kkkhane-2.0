import os
import re

def rep(file, replacements):
    if not os.path.exists(file): return
    with open(file, 'r') as f:
        c = f.read()
    for o, n in replacements:
        c = c.replace(o, n)
    with open(file, 'w') as f:
        f.write(c)

# 1. page.tsx
rep("src/app/page.tsx", [
    ('<div className="bg-transparent rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline', '<div className="bg-surface rounded-[2.5rem] p-10 relative overflow-hidden group border border-hairline'),
    ('Built in Nepal 🇳🇵', 'Built in Nepal'),
    ('Get in Touch 👋', 'Get in Touch'),
    ('🚀', '')
])

# 2. features/page.tsx
c_features = "import { ArrowRight, CheckCircle, Smartphone, ChefHat, CreditCard, Users, Gift, BarChart } from 'lucide-react'"
rep("src/app/features/page.tsx", [
    ("import { ArrowRight, CheckCircle } from 'lucide-react'", c_features),
    ("icon: '📱'", "icon: Smartphone"),
    ("icon: '👨‍🍳'", "icon: ChefHat"),
    ("icon: '💳'", "icon: CreditCard"),
    ("icon: '👥'", "icon: Users"),
    ("icon: '🎁'", "icon: Gift"),
    ("icon: '📊'", "icon: BarChart"),
    ('<span className="mb-6 inline-block text-4xl">{feature.icon}</span>', '<div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20"><feature.icon size={28} strokeWidth={1.5} /></div>')
])

# 3. features/[slug]/page.tsx
c_features_slug = """import { 
    CheckCircle, ClipboardList, Package, CircleDollarSign, Smartphone, Armchair, LineChart, Gift, Handshake,
    Printer, Utensils, Receipt, 
    PackagePlus, ShoppingCart, TrendingDown, BellRing, 
    Wallet, FileText, CalendarCheck, PieChart, 
    QrCode, Eye, Pointer, CreditCard, 
    LayoutDashboard, Users, Check, RefreshCw, 
    BarChart3, Activity, Target, Download, 
    Star, Heart, Award, 
    Share2, Link as LinkIcon, UserPlus, Zap
} from 'lucide-react'"""
rep("src/app/features/[slug]/page.tsx", [
    ("import { \n    CheckCircle, \n    Smartphone", c_features_slug.replace('import { \n    CheckCircle, \n    Smartphone', '')), # will just do a regex replace
])
with open("src/app/features/[slug]/page.tsx", "r") as f:
    c = f.read()
c = re.sub(r"import \{[\s\S]*?\} from 'lucide-react'", c_features_slug, c)
c = c.replace("icon: '📝'", "icon: ClipboardList")
c = c.replace("icon: '📦'", "icon: Package")
c = c.replace("icon: '💰'", "icon: CircleDollarSign")
c = c.replace("icon: '📱'", "icon: Smartphone")
c = c.replace("icon: '🪑'", "icon: Armchair")
c = c.replace("icon: '📈'", "icon: LineChart")
c = c.replace("icon: '🎁'", "icon: Gift")
c = c.replace("icon: '🤝'", "icon: Handshake")
c = c.replace('<span className="mr-6 inline-block text-5xl">{data.icon}</span>', '<div className="mr-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/20"><data.icon size={32} strokeWidth={1.5} /></div>')
c = c.replace('🚀', '')
with open("src/app/features/[slug]/page.tsx", "w") as f:
    f.write(c)

# 4. contact/page.tsx
rep("src/app/contact/page.tsx", [
    ("import { MarketingNav, MarketingFooter, Eyebrow } from '@/components/marketing'", "import { MarketingNav, MarketingFooter, Eyebrow } from '@/components/marketing'\nimport { Mail, Phone, MapPin } from 'lucide-react'"),
    ('<span className="mb-6 inline-block text-4xl">📧</span>', '<div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]"><Mail size={24} /></div>'),
    ('<span className="mb-6 inline-block text-4xl">📞</span>', '<div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-600"><Phone size={24} /></div>'),
    ('<span className="mb-6 inline-block text-4xl">📍</span>', '<div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10 text-green-600"><MapPin size={24} /></div>')
])

# 5. customer-stories
rep("src/app/customer-stories/page.tsx", [
    ('🏔', ''),
    ('🍛', ''),
    ('🥟', '')
])

# 6. blog
rep("src/app/blog/page.tsx", [
    ('🚀', '')
])

# 7. footer
rep("src/components/marketing/MarketingFooter.tsx", [
    ('Get in Touch 👋', 'Get in Touch')
])

