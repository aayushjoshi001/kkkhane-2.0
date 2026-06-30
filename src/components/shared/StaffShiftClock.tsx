'use client'

import { useState, useEffect, useCallback } from 'react'
import { clockIn, clockOut, getActiveShift, getShiftHistory, getShiftStats } from '@/app/api/staff/actions'
import type { StaffShift } from '@/types/database'
import { Clock, LogIn, LogOut, History, ChefHat, Package, Bike, PartyPopper, X } from 'lucide-react'
import { toast } from 'react-hot-toast'

type ShiftSummary = {
    hours: string
    mealsCooked: number
    ordersHandled: number
    deliveries: number
}

interface StaffShiftClockProps {
    userId: string
    restaurantId: string
    initialShift: StaffShift | null
    initialHistory: StaffShift[]
    dark?: boolean
}

function formatDuration(start: string, end?: string | null): string {
    const startDate = new Date(start)
    const endDate = end ? new Date(end) : new Date()
    const diffMs = endDate.getTime() - startDate.getTime()
    const hours = Math.floor(diffMs / (1000 * 60 * 60))
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
}

function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function StaffShiftClock({ userId, restaurantId, initialShift, initialHistory, dark }: StaffShiftClockProps) {
    const [activeShift, setActiveShift] = useState<StaffShift | null>(initialShift)
    const [history, setHistory] = useState<StaffShift[]>(initialHistory)
    const [loading, setLoading] = useState(false)
    const [showHistory, setShowHistory] = useState(false)
    const [summary, setSummary] = useState<ShiftSummary | null>(null)
    const [elapsedTime, setElapsedTime] = useState(
        initialShift ? formatDuration(initialShift.clock_in) : ''
    )

    const refreshData = useCallback(async () => {
        const [shift, shifts] = await Promise.all([
            getActiveShift(userId),
            getShiftHistory(userId),
        ])
        setActiveShift(shift)
        setHistory(shifts)
    }, [userId])

    // Live elapsed timer when clocked in
    useEffect(() => {
        if (!activeShift) return

        const tick = () => setElapsedTime(formatDuration(activeShift.clock_in))
        const interval = setInterval(tick, 60_000)
        return () => clearInterval(interval)
    }, [activeShift])

    async function handleClockIn() {
        setLoading(true)
        const result = await clockIn(userId, restaurantId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success("Clocked in successfully!")
            setActiveShift(result.shift || null)
        }
        setLoading(false)
    }

    async function handleClockOut() {
        setLoading(true)
        const result = await clockOut(userId)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success("Clocked out successfully!")
            // Build the end-of-shift summary before clearing the active shift.
            if (result.shift) {
                const stats = await getShiftStats(userId, result.shift.clock_in, result.shift.clock_out)
                setSummary({
                    hours: formatDuration(result.shift.clock_in, result.shift.clock_out),
                    ...stats,
                })
            }
            setActiveShift(null)
            await refreshData()
        }
        setLoading(false)
    }

    const base = dark
        ? 'bg-dark-surface border-dark-border text-dark-ink'
        : 'bg-surface border-hairline'

    const t = {
        elapsed: dark ? 'text-dark-ink' : 'text-ink',
        muted: dark ? 'text-dark-muted' : 'text-ink-muted',
        label: dark ? 'text-dark-ink/80' : 'text-ink-muted',
        divider: dark ? 'border-dark-border' : 'border-hairline',
        hover: dark ? 'hover:bg-white/5' : 'hover:bg-surface-muted',
        historyRow: dark ? 'bg-white/5' : 'bg-surface-muted',
        historyText: dark ? 'text-dark-ink' : 'text-ink',
        iconBg: activeShift ? 'bg-success/20' : dark ? 'bg-white/5' : 'bg-surface-muted',
    }

    return (
        <div className={`rounded-xl shadow-sm border overflow-hidden ${base}`}>
            {/* Current status */}
            <div className="p-4 md:p-6 text-center">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-3 ${t.iconBg}`}>
                    <Clock className={`w-8 h-8 ${activeShift ? 'text-green-400' : dark ? 'text-gray-500' : 'text-gray-400'}`} />
                </div>

                <p className={`text-sm font-medium ${activeShift ? 'text-green-400' : t.muted}`}>
                    {activeShift ? 'Currently Clocked In' : 'Not Clocked In'}
                </p>

                {activeShift && (
                    <div className="mt-2 space-y-1">
                        <p className={`text-3xl font-bold font-mono ${t.elapsed}`}>{elapsedTime}</p>
                        <p className={`text-xs ${t.muted}`}>Since {formatTime(activeShift.clock_in)}</p>
                    </div>
                )}

                {/* Clock In / Out button */}
                <div className="mt-4 md:mt-6">
                    {activeShift ? (
                        <button
                            onClick={handleClockOut}
                            disabled={loading}
                            className="w-full bg-danger text-white font-semibold rounded-[var(--r-md)] h-12 flex items-center justify-center gap-2 hover:brightness-95 active:brightness-90 disabled:opacity-50 transition-[filter]"
                        >
                            <LogOut size={18} />
                            {loading ? 'Clocking Out...' : 'Clock Out'}
                        </button>
                    ) : (
                        <button
                            onClick={handleClockIn}
                            disabled={loading}
                            className="w-full bg-success text-white font-semibold rounded-[var(--r-md)] h-12 flex items-center justify-center gap-2 hover:brightness-95 active:brightness-90 disabled:opacity-50 transition-[filter]"
                        >
                            <LogIn size={18} />
                            {loading ? 'Clocking In...' : 'Clock In'}
                        </button>
                    )}
                </div>
            </div>

            {/* History toggle */}
            <div className={`border-t ${t.divider}`}>
                <button
                    onClick={() => setShowHistory(!showHistory)}
                    className={`w-full px-6 py-3 flex items-center justify-between text-sm font-medium ${t.label} ${t.hover} transition-colors`}
                >
                    <span className="flex items-center gap-2">
                        <History size={16} />
                        Recent Shifts
                    </span>
                    <span className={`text-xs ${t.muted}`}>{showHistory ? 'Hide' : 'Show'}</span>
                </button>

                {showHistory && (
                    <div className="px-6 pb-4 space-y-2 max-h-64 overflow-y-auto">
                        {history.length === 0 && (
                            <p className={`text-sm text-center py-4 ${t.muted}`}>No shift history.</p>
                        )}
                        {history.filter(s => s.clock_out).map((shift) => (
                            <div key={shift.id} className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${t.historyRow}`}>
                                <div>
                                    <span className={`font-medium ${t.historyText}`}>{formatDate(shift.clock_in)}</span>
                                    <span className={`mx-1 ${t.muted}`}>·</span>
                                    <span className={t.muted}>
                                        {formatTime(shift.clock_in)} – {shift.clock_out ? formatTime(shift.clock_out) : '—'}
                                    </span>
                                </div>
                                <span className={`font-mono ${t.label}`}>
                                    {shift.clock_out ? formatDuration(shift.clock_in, shift.clock_out) : '—'}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* End-of-shift congrats summary */}
            {summary && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setSummary(null)}>
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-gradient-to-b from-[#FB6303] to-[#e25600] text-white px-6 pt-7 pb-6 relative">
                            <button onClick={() => setSummary(null)} className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center" aria-label="Close">
                                <X size={16} />
                            </button>
                            <PartyPopper size={40} className="mx-auto mb-2" />
                            <h3 className="text-xl font-black">Shift complete!</h3>
                            <p className="text-white/85 text-sm mt-1">Congratulations — you successfully completed today&apos;s shift.</p>
                            <p className="text-white/90 font-mono font-bold mt-3 text-lg">{summary.hours}</p>
                        </div>
                        <div className="p-5 grid grid-cols-3 gap-3">
                            {[
                                { icon: ChefHat, label: 'Meals cooked', value: summary.mealsCooked },
                                { icon: Package, label: 'Orders served', value: summary.ordersHandled },
                                { icon: Bike, label: 'Deliveries', value: summary.deliveries },
                            ].map(({ icon: Icon, label, value }) => (
                                <div key={label} className="rounded-2xl border border-gray-100 bg-gray-50 py-3">
                                    <Icon size={18} className="mx-auto text-[#FB6303] mb-1" />
                                    <p className="text-2xl font-black text-gray-900 leading-none">{value}</p>
                                    <p className="text-[10px] text-gray-500 mt-1">{label}</p>
                                </div>
                            ))}
                        </div>
                        <div className="px-5 pb-5">
                            <button onClick={() => setSummary(null)} className="w-full bg-gray-900 text-white font-bold rounded-xl py-3 text-sm hover:bg-gray-800">
                                Done & Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
