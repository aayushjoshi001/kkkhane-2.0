'use client'

import { useEffect, useState } from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { Search, CornerDownLeft } from 'lucide-react'
import { COMMAND_OPEN_EVENT } from './CommandHint'
import { getCommandsForRole } from './commandPaletteConfig'
import { useFeatures } from '@/lib/contexts/FeatureContext'

export type CommandPaletteTheme = 'light' | 'dark'

interface Props {
    /** The current user's role — decides which commands are listed. */
    role?: string
    /** Match the surrounding surface; kitchen runs on the dark theme. */
    theme?: CommandPaletteTheme
}

// Theme tokens kept in one place so the palette tracks the site's design system.
const THEMES = {
    light: {
        overlay: 'bg-black/10 dark:bg-black/40',
        panel: 'bg-surface border-hairline',
        divider: 'border-hairline',
        icon: 'text-ink-subtle',
        input: 'text-ink placeholder:text-ink-subtle',
        empty: 'text-ink-subtle',
        heading: 'text-ink-subtle',
        item: 'text-ink-muted aria-selected:bg-surface-muted aria-selected:text-ink',
        itemIcon: 'text-ink-subtle group-aria-selected:text-brand-500',
        enterHint: 'text-brand-500',
        footer: 'border-hairline bg-surface-muted/50 text-ink-subtle',
        kbd: 'border-hairline-strong bg-surface text-ink-subtle',
    },
    dark: {
        overlay: 'bg-black/60',
        panel: 'bg-dark border-dark-border',
        divider: 'border-dark-border',
        icon: 'text-dark-muted',
        input: 'text-dark-ink placeholder:text-dark-muted',
        empty: 'text-dark-muted',
        heading: 'text-dark-muted',
        item: 'text-dark-muted aria-selected:bg-dark-raised aria-selected:text-dark-ink',
        itemIcon: 'text-dark-muted group-aria-selected:text-brand-500',
        enterHint: 'text-brand-500',
        footer: 'border-dark-border text-dark-muted',
        kbd: 'border-dark-border bg-dark-raised text-dark-muted',
    },
} as const satisfies Record<CommandPaletteTheme, Record<string, string>>

export function CommandPalette({ role, theme = 'light' }: Props) {
    const [open, setOpen] = useState(false)
    const router = useRouter()
    const t = THEMES[theme]
    
    const features = useFeatures()
    const promosEnabled = features?.promosEnabled ?? true
    const loyaltyEnabled = !!features?.loyaltyEnabled
    const takeoutEnabled = !!features?.takeoutEnabled
    const dynamicPricingEnabled = !!features?.dynamicPricingEnabled
    const ingredientTrackingEnabled = !!features?.ingredientTrackingEnabled
    const staffShiftsEnabled = !!features?.staffShiftsEnabled
    const staffManagementEnabled = features?.staffManagementEnabled ?? true
    const tableManagementEnabled = features?.tableManagementEnabled ?? true
    const financeEnabled = !!features?.financeEnabled
    
    const groups = getCommandsForRole(role)
    const filteredGroups = groups.map(group => {
        let items = group.items

        if (group.heading === 'Finance') {
            items = financeEnabled ? items : []
        } else if (group.heading === 'Menu') {
            items = items.filter(item => {
                if (item.href === '/admin/pricing') return dynamicPricingEnabled
                if (item.href === '/admin/promos') return promosEnabled
                return true
            })
        } else if (group.heading === 'Sales & Service') {
            items = items.filter(item => {
                if (item.href === '/admin/takeout') return takeoutEnabled
                if (item.href === '/admin/tables') return tableManagementEnabled
                return true
            })
        } else if (group.heading === 'Revenue & Growth') {
            items = items.filter(item => {
                if (item.href === '/admin/loyalty') return loyaltyEnabled
                if (item.href === '/admin/reports') return financeEnabled
                return true
            })
        } else if (group.heading === 'Operations') {
            items = items.filter(item => {
                if (item.href === '/admin/ingredients') return ingredientTrackingEnabled
                if (item.href === '/admin/staff') return staffManagementEnabled
                if (item.href === '/admin/shifts') return staffShiftsEnabled
                return true
            })
        }

        return {
            ...group,
            items
        }
    }).filter(group => group.items.length > 0)

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((open) => !open)
            }
        }
        // Allow opening by click (touch devices / the hint button).
        const openEvt = () => setOpen(true)
        document.addEventListener('keydown', down)
        window.addEventListener(COMMAND_OPEN_EVENT, openEvt)
        return () => {
            document.removeEventListener('keydown', down)
            window.removeEventListener(COMMAND_OPEN_EVENT, openEvt)
        }
    }, [])

    const runCommand = (command: () => void) => {
        setOpen(false)
        command()
    }

    if (!open) return null

    return (
        <div
            className={`fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh] backdrop-blur-sm animate-fade-in ${t.overlay}`}
            onClick={() => setOpen(false)}
            role="presentation"
        >
            {/* The global brand-orange :focus-visible outline is suppressed for
                [cmdk-root] in globals.css — focus is shown via aria-selected styling. */}
            <Command
                className={`w-full max-w-xl overflow-hidden rounded-[var(--r-lg)] shadow-2xl border animate-scale-in ${t.panel}`}
                loop
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
            >
                <div className={`flex items-center gap-3 px-4 border-b ${t.divider}`}>
                    <Search className={`size-5 shrink-0 ${t.icon}`} />
                    <Command.Input
                        autoFocus
                        placeholder="Search panels and pages…"
                        className={`flex-1 h-14 bg-transparent text-body ${t.input}`}
                    />
                </div>

                <Command.List className="max-h-[min(60vh,340px)] overflow-y-auto p-2 scrollbar-thin">
                    <Command.Empty className={`py-10 text-center text-small ${t.empty}`}>
                        No results found.
                    </Command.Empty>

                    {filteredGroups.map((group, gi) => (
                        <Command.Group
                            key={group.heading}
                            heading={group.heading}
                            className={`px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider ${t.heading} ${gi > 0 ? 'mt-1' : ''}`}
                        >
                            {group.items.map((item) => {
                                const Icon = item.icon
                                return (
                                    <Command.Item
                                        key={item.href}
                                        value={`${item.label} ${item.keywords?.join(' ') ?? ''}`}
                                        onSelect={() => runCommand(() => router.push(item.href))}
                                        className={`group flex items-center gap-3 px-3 h-10 my-0.5 text-sm rounded-[var(--r-md)] cursor-pointer select-none transition-colors duration-100 ${t.item}`}
                                    >
                                        <Icon size={17} className={`shrink-0 transition-colors ${t.itemIcon}`} />
                                        <span className="flex-1 truncate font-medium">{item.label}</span>
                                        <CornerDownLeft
                                            size={14}
                                            className={`shrink-0 opacity-0 transition-opacity group-aria-selected:opacity-100 ${t.enterHint}`}
                                        />
                                    </Command.Item>
                                )
                            })}
                        </Command.Group>
                    ))}
                </Command.List>

                <div className={`flex items-center gap-4 px-4 py-2.5 border-t text-[11px] ${t.footer}`}>
                    <span className="flex items-center gap-1.5">
                        <kbd className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border font-sans ${t.kbd}`}>↑</kbd>
                        <kbd className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border font-sans ${t.kbd}`}>↓</kbd>
                        Navigate
                    </span>
                    <span className="flex items-center gap-1.5">
                        <kbd className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded border font-sans ${t.kbd}`}>↵</kbd>
                        Open
                    </span>
                    <span className="ml-auto flex items-center gap-1.5">
                        <kbd className={`inline-flex items-center justify-center h-[18px] px-1.5 rounded border font-sans ${t.kbd}`}>esc</kbd>
                        Close
                    </span>
                </div>
            </Command>
        </div>
    )
}
