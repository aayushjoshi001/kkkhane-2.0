import {
    LayoutDashboard, BarChart3, Building2, CreditCard, UtensilsCrossed,
    ShoppingBag, Truck, Users, Clock, DollarSign, Heart, Tag, Package,
    Grid3X3, FileText, Settings, Sparkles, Palette, ChefHat, ClipboardList,
    Wallet, Landmark, TrendingUp, Receipt, HandCoins, ArrowUpRight, Banknote,
    PiggyBank, Percent, BookOpen, FileBarChart, Settings2, ShieldCheck, Wrench,
    type LucideIcon,
} from 'lucide-react'

export interface CommandItem {
    label: string
    href: string
    icon: LucideIcon
    /** Extra search terms beyond the label, so a command surfaces for related words. */
    keywords?: string[]
}

export interface CommandGroup {
    heading: string
    items: CommandItem[]
}

const SUPER_BASE = '/admin/super-admin'

// Mirrors SuperAdminSidebar — the network-wide control panel.
const SUPER_ADMIN_GROUPS: CommandGroup[] = [
    {
        heading: 'Overview',
        items: [
            { label: 'Dashboard', href: `${SUPER_BASE}/dashboard`, icon: LayoutDashboard, keywords: ['home', 'overview'] },
            { label: 'Analytics', href: `${SUPER_BASE}/analytics`, icon: BarChart3, keywords: ['stats', 'metrics'] },
        ],
    },
    {
        heading: 'Network',
        items: [
            { label: 'Businesses', href: `${SUPER_BASE}/restaurants`, icon: Building2, keywords: ['tenants', 'outlets', 'restaurants', 'hotels'] },
            { label: 'Payments', href: `${SUPER_BASE}/payments`, icon: CreditCard, keywords: ['billing', 'revenue'] },
        ],
    },
    {
        heading: 'Catalog',
        items: [
            { label: 'Menus', href: `${SUPER_BASE}/menus`, icon: UtensilsCrossed, keywords: ['dishes', 'food'] },
            { label: 'Orders', href: `${SUPER_BASE}/orders`, icon: ShoppingBag, keywords: ['tickets'] },
            { label: 'Takeout', href: `${SUPER_BASE}/takeout`, icon: Truck, keywords: ['delivery', 'pickup'] },
        ],
    },
    {
        heading: 'Team',
        items: [
            { label: 'Staff', href: `${SUPER_BASE}/staff`, icon: Users, keywords: ['employees', 'team'] },
            { label: 'Staff Shifts', href: `${SUPER_BASE}/shifts`, icon: Clock, keywords: ['rota', 'schedule'] },
        ],
    },
    {
        heading: 'Revenue & Catalog',
        items: [
            { label: 'Pricing', href: `${SUPER_BASE}/pricing`, icon: DollarSign, keywords: ['price'] },
            { label: 'Loyalty', href: `${SUPER_BASE}/loyalty`, icon: Heart, keywords: ['rewards', 'points'] },
            { label: 'Promos', href: `${SUPER_BASE}/promos`, icon: Tag, keywords: ['discount', 'coupon'] },
            { label: 'Ingredients', href: `${SUPER_BASE}/ingredients`, icon: Package, keywords: ['stock', 'inventory'] },
            { label: 'Tables & QR', href: `${SUPER_BASE}/tables`, icon: Grid3X3, keywords: ['qr', 'seating'] },
        ],
    },
    {
        heading: 'Config',
        items: [
            { label: 'EOD Reports', href: `${SUPER_BASE}/reports`, icon: FileText, keywords: ['end of day', 'summary'] },
            { label: 'Config', href: `${SUPER_BASE}/config`, icon: Settings, keywords: ['settings', 'configuration'] },
        ],
    },
]

// Mirrors AdminSidebar — a single restaurant's management console.
const MANAGER_GROUPS: CommandGroup[] = [
    {
        heading: 'Overview',
        items: [
            { label: 'Overview', href: '/admin/dashboard', icon: BarChart3, keywords: ['home', 'dashboard'] },
        ],
    },
    {
        heading: 'Menu',
        items: [
            { label: 'Menu', href: '/admin/menu', icon: UtensilsCrossed, keywords: ['dishes', 'food', 'items'] },
            { label: 'Combo Offers', href: '/admin/combos', icon: Sparkles, keywords: ['bundle', 'meal deal'] },
            { label: 'Dynamic Pricing', href: '/admin/pricing', icon: DollarSign, keywords: ['price', 'happy hour'] },
            { label: 'Promo Codes', href: '/admin/promos', icon: Tag, keywords: ['discount', 'coupon'] },
        ],
    },
    {
        heading: 'Sales & Service',
        items: [
            { label: 'Orders', href: '/admin/orders', icon: ShoppingBag, keywords: ['tickets'] },
            { label: 'Payments', href: '/admin/payments', icon: CreditCard, keywords: ['billing'] },
            { label: 'Takeout', href: '/admin/takeout', icon: Truck, keywords: ['delivery', 'pickup'] },
            { label: 'Tables & QR', href: '/admin/tables', icon: Grid3X3, keywords: ['qr', 'seating'] },
        ],
    },
    {
        heading: 'Revenue & Growth',
        items: [
            { label: 'Loyalty', href: '/admin/loyalty', icon: Heart, keywords: ['rewards', 'points'] },
            { label: 'EOD Reports', href: '/admin/reports', icon: FileText, keywords: ['end of day', 'summary'] },
            { label: 'Analytics', href: '/admin/analytics', icon: BarChart3, keywords: ['stats', 'metrics'] },
        ],
    },
    {
        heading: 'Operations',
        items: [
            { label: 'Ingredients', href: '/admin/ingredients', icon: Package, keywords: ['stock', 'inventory'] },
            { label: 'Staff', href: '/admin/staff', icon: Users, keywords: ['employees', 'team'] },
            { label: 'Staff Shifts', href: '/admin/shifts', icon: Clock, keywords: ['rota', 'schedule'] },
        ],
    },
    {
        heading: 'Config',
        items: [
            { label: 'Homepage', href: '/admin/homepage', icon: Palette, keywords: ['landing', 'site'] },
            { label: 'Brand & Theme', href: '/admin/theme', icon: Palette, keywords: ['colors', 'logo'] },
            { label: 'Settings', href: '/admin/settings', icon: Settings, keywords: ['configuration'] },
        ],
    },
    {
        heading: 'Finance',
        items: [
            { label: 'Finance Dashboard', href: '/admin/finance', icon: LayoutDashboard, keywords: ['overview', 'kpi'] },
            { label: 'Cash Management', href: '/admin/finance/cash', icon: Wallet, keywords: ['drawer', 'cash in', 'cash out'] },
            { label: 'Bank Management', href: '/admin/finance/bank', icon: Landmark, keywords: ['bank', 'wallet', 'esewa', 'khalti'] },
            { label: 'Income', href: '/admin/finance/income', icon: TrendingUp, keywords: ['revenue', 'other income'] },
            { label: 'Expenses', href: '/admin/finance/expenses', icon: Receipt, keywords: ['bills', 'spending'] },
            { label: 'Receivables', href: '/admin/finance/receivables', icon: HandCoins, keywords: ['customer credit', 'outstanding'] },
            { label: 'Payables', href: '/admin/finance/payables', icon: ArrowUpRight, keywords: ['supplier bills', 'outstanding'] },
            { label: 'Loans', href: '/admin/finance/loans', icon: Banknote, keywords: ['emi', 'interest'] },
            { label: 'Budget', href: '/admin/finance/budget', icon: PiggyBank, keywords: ['planning', 'variance'] },
            { label: 'Tax', href: '/admin/finance/tax', icon: Percent, keywords: ['vat', 'pan', 'ird'] },
            { label: 'Financial Books', href: '/admin/finance/books', icon: BookOpen, keywords: ['daybook', 'ledger'] },
            { label: 'Financial Statements', href: '/admin/finance/statements', icon: FileBarChart, keywords: ['trial balance', 'profit and loss', 'balance sheet'] },
            { label: 'Finance Reports', href: '/admin/finance/reports', icon: FileText, keywords: ['sales', 'cash', 'bank'] },
            { label: 'Finance Administration', href: '/admin/finance/administration', icon: Settings2, keywords: ['chart of accounts', 'voucher types', 'fiscal year'] },
            { label: 'Finance Audit', href: '/admin/finance/audit', icon: ShieldCheck, keywords: ['audit trail', 'activity'] },
            { label: 'Finance Tools', href: '/admin/finance/tools', icon: Wrench, keywords: ['import', 'export', 'backup'] },
        ],
    },
]

// Front-of-house staff move between their own portal and the till.
const WAITER_GROUPS: CommandGroup[] = [
    {
        heading: 'Workspace',
        items: [
            { label: 'Waiter Portal', href: '/waiter', icon: ClipboardList, keywords: ['orders', 'tables', 'service'] },
            { label: 'Cashier / Billing', href: '/cashier', icon: CreditCard, keywords: ['till', 'payment', 'checkout'] },
        ],
    },
]

// The cashier lives at the till, settling bills and collecting payments.
const CASHIER_GROUPS: CommandGroup[] = [
    {
        heading: 'Workspace',
        items: [
            { label: 'Cashier / Billing', href: '/cashier', icon: CreditCard, keywords: ['till', 'payment', 'checkout', 'counter'] },
        ],
    },
]

const KITCHEN_GROUPS: CommandGroup[] = [
    {
        heading: 'Workspace',
        items: [
            { label: 'Kitchen Display', href: '/kitchen', icon: ChefHat, keywords: ['kds', 'orders', 'tickets'] },
        ],
    },
]

/**
 * Returns the command palette groups a given role is allowed to navigate to.
 * Keeps the palette in sync with each role's sidebar/portal and prevents
 * surfacing routes a role cannot access.
 */
export function getCommandsForRole(role: string | undefined): CommandGroup[] {
    switch (role) {
        case 'super_admin':
            return SUPER_ADMIN_GROUPS
        case 'manager':
            return MANAGER_GROUPS
        case 'waiter':
            return WAITER_GROUPS
        case 'cashier':
            return CASHIER_GROUPS
        case 'kitchen':
            return KITCHEN_GROUPS
        default:
            return []
    }
}
