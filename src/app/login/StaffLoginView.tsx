'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, Delete, ChefHat, User, Banknote, Loader2, Check, Store } from 'lucide-react'
import { getActiveStaffForTerminal, staffPinLoginAction, type TerminalStaffMember } from './staffActions'

type Phase = 'resolving' | 'slug-entry' | 'grid' | 'pin' | 'success'

export const STAFF_TERMINAL_STORAGE_KEY = 'kkkhane_staff_terminal_slug'

function roleIcon(roleName: string) {
    switch (roleName) {
        case 'kitchen': return <ChefHat size={18} className="text-orange-500" />
        case 'cashier': return <Banknote size={18} className="text-emerald-500" />
        default: return <User size={18} className="text-blue-500" />
    }
}

export default function StaffLoginView({ initialSlug, onSwitchToOwnerLogin }: { initialSlug?: string; onSwitchToOwnerLogin: () => void }) {
    const router = useRouter()

    const [phase, setPhase] = useState<Phase>('resolving')
    const [slugInput, setSlugInput] = useState(initialSlug || '')
    const [slugError, setSlugError] = useState<string | null>(null)
    const [resolving, setResolving] = useState(false)

    const [restaurant, setRestaurant] = useState<{ id: string; name: string; logoUrl: string | null } | null>(null)
    const [staffList, setStaffList] = useState<TerminalStaffMember[]>([])
    const [selectedStaff, setSelectedStaff] = useState<TerminalStaffMember | null>(null)

    const [digits, setDigits] = useState('')
    const [isShaking, setIsShaking] = useState(false)
    const [pinError, setPinError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const resolveSlug = useCallback(async (slug: string) => {
        setResolving(true)
        setSlugError(null)
        const res = await getActiveStaffForTerminal(slug)
        setResolving(false)

        if (!res.restaurant) {
            setSlugError(res.error || 'No restaurant found for that code')
            setPhase('slug-entry')
            return
        }

        localStorage.setItem(STAFF_TERMINAL_STORAGE_KEY, slug.trim().toLowerCase())
        setRestaurant(res.restaurant)
        setStaffList(res.staff || [])
        router.replace(`/login?r=${slug.trim().toLowerCase()}`, { scroll: false })
        setPhase('grid')
    }, [router])

    useEffect(() => {
        const remembered = initialSlug || localStorage.getItem(STAFF_TERMINAL_STORAGE_KEY)
        if (remembered) {
            resolveSlug(remembered)
        } else {
            setPhase('slug-entry')
        }
        // Only ever run this resolution once on mount — resolveSlug is stable via useCallback.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const handleSwitchRestaurant = () => {
        localStorage.removeItem(STAFF_TERMINAL_STORAGE_KEY)
        setRestaurant(null)
        setStaffList([])
        setSlugInput('')
        router.replace('/login', { scroll: false })
        setPhase('slug-entry')
    }

    const selectStaff = (member: TerminalStaffMember) => {
        setSelectedStaff(member)
        setDigits('')
        setPinError(null)
        setPhase('pin')
    }

    const backToGrid = () => {
        setSelectedStaff(null)
        setDigits('')
        setPinError(null)
        setPhase('grid')
    }

    const submitPin = useCallback(async (pin: string) => {
        if (!selectedStaff || !restaurant) return
        setIsSubmitting(true)
        const res = await staffPinLoginAction({ userId: selectedStaff.id, restaurantId: restaurant.id, pin })
        setIsSubmitting(false)

        if (!res.success) {
            setPinError(res.error || 'Incorrect PIN')
            setIsShaking(true)
            setTimeout(() => setIsShaking(false), 400)
            setTimeout(() => setDigits(''), 550)
            return
        }

        setPhase('success')
        setTimeout(() => router.push(res.landing || '/'), 500)
    }, [selectedStaff, restaurant, router])

    const pressDigit = (d: string) => {
        if (isSubmitting || digits.length >= 4) return
        setPinError(null)
        const next = digits + d
        setDigits(next)
        if (next.length === 4) submitPin(next)
    }

    const pressBackspace = () => {
        if (isSubmitting) return
        setDigits(d => d.slice(0, -1))
    }

    // ── Resolving (initial load) ──
    if (phase === 'resolving') {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
                <Loader2 size={28} className="animate-spin text-[var(--color-primary)]" />
                <p className="text-sm text-gray-400 font-medium">Finding your terminal…</p>
            </div>
        )
    }

    // ── Slug entry ──
    if (phase === 'slug-entry') {
        return (
            <div className="w-full bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 pt-3 pb-8 px-8 sm:px-10 flex flex-col items-center animate-in fade-in duration-300">
                <div className="w-10 h-1.5 rounded-full bg-gray-200 mb-6" />
                <div className="w-14 h-14 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-5">
                    <Store size={26} className="text-[var(--color-primary)]" />
                </div>
                <div className="text-center mb-7">
                    <h1 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">Staff Sign-in</h1>
                    <p className="text-sm text-gray-500 font-medium">Enter your restaurant&apos;s code to pull up the team list.</p>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); if (slugInput.trim()) resolveSlug(slugInput) }} className="w-full flex flex-col gap-4">
                    {slugError && (
                        <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 font-medium text-center">
                            {slugError}
                        </div>
                    )}
                    <input
                        type="text"
                        value={slugInput}
                        onChange={(e) => setSlugInput(e.target.value)}
                        placeholder="e.g. himalayan-kitchen"
                        autoFocus
                        className="h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm outline-none text-gray-900 placeholder:text-gray-400 focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] transition-all text-center font-semibold"
                    />
                    <button
                        type="submit"
                        disabled={resolving || !slugInput.trim()}
                        className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white h-12 rounded-full text-sm font-bold shadow-lg shadow-[var(--color-primary)]/20 transition-all flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {resolving ? <Loader2 size={18} className="animate-spin" /> : 'Continue'}
                    </button>
                </form>

                <button onClick={onSwitchToOwnerLogin} className="text-sm font-semibold text-gray-500 hover:text-gray-700 mt-6 transition-colors">
                    Owner or manager? Sign in here →
                </button>
            </div>
        )
    }

    // ── Name grid ──
    if (phase === 'grid') {
        return (
            <div className="w-full bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 pt-3 pb-8 px-6 sm:px-8 flex flex-col items-center animate-in fade-in duration-300">
                <div className="w-10 h-1.5 rounded-full bg-gray-200 mb-6" />

                <div className="flex flex-col items-center gap-2 mb-7">
                    {restaurant?.logoUrl ? (
                        <Image src={restaurant.logoUrl} alt={restaurant.name} width={48} height={48} className="w-12 h-12 rounded-2xl object-cover shadow-sm" />
                    ) : (
                        <div className="w-12 h-12 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center">
                            <Store size={22} className="text-[var(--color-primary)]" />
                        </div>
                    )}
                    <h1 className="text-xl font-extrabold text-gray-900 text-center">{restaurant?.name}</h1>
                    <p className="text-sm text-gray-400 font-medium">Tap your name to sign in</p>
                </div>

                {staffList.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">No active staff found for this terminal yet.</p>
                ) : (
                    <div className="w-full grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {staffList.map((member, i) => (
                            <button
                                key={member.id}
                                onClick={() => selectStaff(member)}
                                style={{ animationDelay: `${i * 40}ms` }}
                                className="animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 bg-gray-50/60 hover:bg-gray-50 hover:border-gray-200 hover:-translate-y-0.5 active:scale-95 transition-all"
                            >
                                <div className="w-14 h-14 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center overflow-hidden shrink-0">
                                    {member.avatar_url ? (
                                        <Image src={member.avatar_url} alt={member.full_name} width={56} height={56} className="w-full h-full object-cover" />
                                    ) : (
                                        <span className="text-gray-500 font-bold text-lg">{member.full_name.charAt(0).toUpperCase()}</span>
                                    )}
                                </div>
                                <span className="text-sm font-bold text-gray-900 text-center leading-tight">{member.full_name}</span>
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400 capitalize">
                                    {roleIcon(member.roleName)} {member.roleName}
                                </span>
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex items-center gap-4 mt-8">
                    <button onClick={handleSwitchRestaurant} className="text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                        Not your restaurant?
                    </button>
                    <span className="text-gray-200">·</span>
                    <button onClick={onSwitchToOwnerLogin} className="text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors">
                        Owner/manager sign in
                    </button>
                </div>
            </div>
        )
    }

    // ── Success ──
    if (phase === 'success') {
        return (
            <div className="w-full bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 py-16 px-8 flex flex-col items-center animate-in fade-in duration-200">
                <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-5 animate-in zoom-in-50 duration-300">
                    <Check size={30} className="text-emerald-500" strokeWidth={3} />
                </div>
                <h1 className="text-lg font-extrabold text-gray-900">Welcome, {selectedStaff?.full_name.split(' ')[0]}!</h1>
            </div>
        )
    }

    // ── PIN pad ──
    return (
        <div className="w-full bg-white rounded-[2.5rem] shadow-2xl border border-gray-100 pt-3 pb-8 px-6 sm:px-10 flex flex-col items-center animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="w-10 h-1.5 rounded-full bg-gray-200 mb-6" />

            <button onClick={backToGrid} className="self-start flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-600 transition-colors mb-4">
                <ArrowLeft size={14} /> Not you?
            </button>

            <div className="flex flex-col items-center gap-3 mb-6">
                <div className="w-16 h-16 rounded-full bg-gray-50 border border-gray-200 shadow-sm flex items-center justify-center overflow-hidden">
                    {selectedStaff?.avatar_url ? (
                        <Image src={selectedStaff.avatar_url} alt={selectedStaff.full_name} width={64} height={64} className="w-full h-full object-cover" />
                    ) : (
                        <span className="text-gray-500 font-bold text-xl">{selectedStaff?.full_name.charAt(0).toUpperCase()}</span>
                    )}
                </div>
                <h1 className="text-lg font-extrabold text-gray-900">{selectedStaff?.full_name}</h1>
                <p className={`text-xs font-semibold transition-colors ${pinError ? 'text-amber-600' : 'text-gray-400'}`}>
                    {pinError || 'Enter your 4-digit PIN'}
                </p>
            </div>

            {/* Dot indicators */}
            <div className={`flex gap-4 mb-8 ${isShaking ? 'animate-shake' : ''}`}>
                {Array.from({ length: 4 }).map((_, i) => (
                    <div
                        key={i}
                        className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                            i < digits.length
                                ? 'bg-[var(--color-primary)] border-[var(--color-primary)] scale-110'
                                : 'bg-transparent border-gray-300'
                        }`}
                    />
                ))}
            </div>

            {/* Numpad */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-[280px]">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                    <button
                        key={d}
                        onClick={() => pressDigit(d)}
                        disabled={isSubmitting}
                        className="aspect-square rounded-2xl bg-gray-50 border border-gray-100 text-xl font-bold text-gray-900 hover:bg-gray-100 active:scale-95 transition-all disabled:opacity-40"
                    >
                        {d}
                    </button>
                ))}
                <div />
                <button
                    onClick={() => pressDigit('0')}
                    disabled={isSubmitting}
                    className="aspect-square rounded-2xl bg-gray-50 border border-gray-100 text-xl font-bold text-gray-900 hover:bg-gray-100 active:scale-95 transition-all disabled:opacity-40"
                >
                    0
                </button>
                <button
                    onClick={pressBackspace}
                    disabled={isSubmitting}
                    className="aspect-square rounded-2xl flex items-center justify-center text-gray-400 hover:bg-gray-50 active:scale-95 transition-all disabled:opacity-40"
                >
                    <Delete size={20} />
                </button>
            </div>

            {isSubmitting && (
                <div className="flex items-center gap-2 mt-6 text-sm text-gray-400 font-medium">
                    <Loader2 size={16} className="animate-spin" /> Signing in…
                </div>
            )}
        </div>
    )
}
