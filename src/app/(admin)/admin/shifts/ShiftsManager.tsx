'use client'

import { useState } from 'react'
import { approveShiftAction, forceClockOutAction, correctShiftAction } from './actions'
import { Clock, CheckCircle, LogOut, User, Pencil, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@/components/ui/Modal'
import { useFeatureEnabled } from '@/lib/contexts/FeatureContext'
import { toNepaliDate } from '@/lib/nepaliDate'

interface ShiftRow {
    id: string
    user_id: string
    clock_in: string
    clock_out: string | null
    hours_worked: number | null
    break_minutes: number
    notes: string | null
    is_approved: boolean
    users?: { full_name: string | null; role_id: number; roles: { name: string } | null } | null
}

function getStaffName(shift: ShiftRow) {
    return shift.users?.full_name || '—'
}

function getStaffRole(shift: ShiftRow) {
    return shift.users?.roles?.name || '—'
}

function duration(clockIn: string, clockOut?: string | null) {
    const start = new Date(clockIn)
    const end = clockOut ? new Date(clockOut) : new Date()
    const mins = Math.floor((end.getTime() - start.getTime()) / 60000)
    const h = Math.floor(mins / 60)
    const m = mins % 60
    return `${h}h ${m}m`
}

// Format ISO datetime to local datetime-local input value (YYYY-MM-DDTHH:mm)
function toDatetimeLocal(iso: string) {
    const d = new Date(iso)
    const pad = (n: number) => n.toString().padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function CorrectionModal({ shift, onClose, onSaved }: {
    shift: ShiftRow
    onClose: () => void
    onSaved: (updated: ShiftRow) => void
}) {
    const [clockIn, setClockIn] = useState(toDatetimeLocal(shift.clock_in))
    const [clockOut, setClockOut] = useState(shift.clock_out ? toDatetimeLocal(shift.clock_out) : '')
    const [breakMins, setBreakMins] = useState(String(shift.break_minutes || 0))
    const [notes, setNotes] = useState(shift.notes || '')
    const [saving, setSaving] = useState(false)

    async function handleSave() {
        setSaving(true)
        const result = await correctShiftAction(shift.id, {
            clock_in: new Date(clockIn).toISOString(),
            clock_out: clockOut ? new Date(clockOut).toISOString() : undefined,
            break_minutes: parseInt(breakMins) || 0,
            notes: notes || undefined,
        })
        setSaving(false)
        if (result.error) {
            toast.error(result.error)
        } else {
            toast.success('Shift corrected — pending re-approval')
            const totalMins = clockOut
                ? (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 60000
                : 0
            const hoursWorked = clockOut
                ? Math.max(0, Math.round((totalMins - (parseInt(breakMins) || 0)) / 60 * 100) / 100)
                : null
            onSaved({
                ...shift,
                clock_in: new Date(clockIn).toISOString(),
                clock_out: clockOut ? new Date(clockOut).toISOString() : null,
                break_minutes: parseInt(breakMins) || 0,
                notes: notes || null,
                hours_worked: hoursWorked,
                is_approved: false,
            })
            onClose()
        }
    }

    return (
        <Modal open onClose={onClose} size="sm" ariaLabel={`Correct shift — ${getStaffName(shift)}`} className="text-left">
                <div className="px-6 py-5 border-b border-hairline bg-surface-muted/30 flex justify-between items-center">
                    <h2 className="text-h3 font-extrabold text-ink flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 border border-brand-100 shadow-[inset_0_2px_4px_rgba(251,99,3,0.05)]">
                            <Pencil size={14} />
                        </div>
                        Correct Shift — {getStaffName(shift)}
                    </h2>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-surface border border-hairline flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-surface-muted transition-colors shadow-sm focus-ring">
                        <X size={16} />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Clock In</label>
                        <input type="datetime-local" value={clockIn} onChange={e => setClockIn(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Clock Out <span className="text-ink-muted">(leave blank if still active)</span></label>
                        <input type="datetime-local" value={clockOut} onChange={e => setClockOut(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Break (minutes)</label>
                        <input type="number" min="0" value={breakMins} onChange={e => setBreakMins(e.target.value)}
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3 tabular-nums" />
                    </div>
                    <div>
                        <label className="block text-[11px] font-bold text-ink-subtle uppercase tracking-wider mb-2">Notes <span className="text-ink-muted">(optional)</span></label>
                        <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                            placeholder="e.g. missed punch, system error…"
                            className="w-full bg-surface border border-hairline rounded-[var(--r-md)] text-sm font-bold text-ink placeholder:text-ink-muted focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:border-brand-500 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] transition-all p-3" />
                    </div>

                    <p className="text-[11px] font-bold text-amber-700/80 uppercase tracking-wider bg-amber-50/50 border border-amber-200/50 rounded-[var(--r-md)] p-3">
                        Corrected shifts are reset to <strong className="text-amber-900">Pending</strong> and must be re-approved.
                    </p>
                </div>

                <div className="px-6 py-5 bg-surface-muted/30 border-t border-hairline flex justify-end gap-3">
                    <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-ink bg-surface border border-hairline rounded-[var(--r-md)] shadow-sm hover:bg-surface-muted transition-colors focus-ring" disabled={saving}>Cancel</button>
                    <button onClick={handleSave} disabled={saving || !clockIn}
                        className="px-6 py-2.5 text-sm font-bold text-white bg-brand-500 rounded-[var(--r-md)] shadow-[0_4px_12px_rgba(251,99,3,0.25)] hover:shadow-[0_6px_16px_rgba(251,99,3,0.4)] hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 flex items-center gap-2 focus-ring">
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        Save Correction
                    </button>
                </div>
        </Modal>
    )
}

export default function ShiftsManager({ activeShifts, recentShifts }: {
    activeShifts: ShiftRow[]
    recentShifts: ShiftRow[]
}) {
    const [active, setActive] = useState(activeShifts)
    const [recent, setRecent] = useState(recentShifts)
    const [correcting, setCorrecting] = useState<ShiftRow | null>(null)
    const bsEnabled = useFeatureEnabled('bsDateEnabled')

    async function handleForceClockOut(shift: ShiftRow) {
        if (!confirm(`Force clock-out ${getStaffName(shift)}?`)) return
        const result = await forceClockOutAction(shift.id)
        if (result.error) { toast.error(result.error); return }
        setActive(prev => prev.filter(s => s.id !== shift.id))
        toast.success('Clocked out')
    }

    async function handleApprove(shift: ShiftRow) {
        const result = await approveShiftAction(shift.id, shift.user_id)
        if (result.error) { toast.error(result.error); return }
        setRecent(prev => prev.map(s => s.id === shift.id ? { ...s, is_approved: true } : s))
        toast.success('Shift approved')
    }

    return (
        <div className="space-y-6">
            {correcting && (
                <CorrectionModal
                    shift={correcting}
                    onClose={() => setCorrecting(null)}
                    onSaved={(updated) => {
                        setRecent(prev => prev.map(s => s.id === updated.id ? updated : s))
                        setActive(prev => prev.map(s => s.id === updated.id ? updated : s))
                    }}
                />
            )}

            {/* Active Shifts */}
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                <div className="px-5 py-4 border-b border-hairline bg-surface-muted/30 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100 shadow-[inset_0_2px_4px_rgba(16,185,129,0.05)]">
                        <Clock size={16} />
                    </div>
                    <h2 className="text-sm font-extrabold text-ink">Currently Clocked In <span className="text-ink-subtle ml-1">({active.length})</span></h2>
                </div>
                {active.length === 0 ? (
                    <div className="px-5 py-12 text-center text-ink-muted font-bold text-sm">No staff currently clocked in.</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/30 border-b border-hairline">
                            <tr>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Staff</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden md:table-cell">Role</th>
                                <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Clocked In</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Duration</th>
                                <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {active.map(s => (
                                <tr key={s.id} className="hover:bg-surface-muted/30 transition-colors">
                                    <td className="px-5 py-4 flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-surface-muted border border-hairline flex items-center justify-center text-ink-subtle shrink-0">
                                            <User size={14} />
                                        </div>
                                        <span className="font-extrabold text-ink">{getStaffName(s)}</span>
                                    </td>
                                    <td className="px-5 py-4 text-ink-subtle font-medium capitalize hidden md:table-cell">{getStaffRole(s)}</td>
                                    <td className="px-5 py-4 text-ink font-bold tabular-nums">{new Date(s.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td className="px-5 py-4 text-right font-bold text-brand-500 tabular-nums">{duration(s.clock_in)}</td>
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-2 justify-end">
                                            <button onClick={() => setCorrecting(s)}
                                                className="px-3 py-1.5 rounded-[var(--r-md)] border border-hairline text-[11px] font-bold text-ink-subtle uppercase tracking-wider hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all flex items-center gap-1.5 shadow-sm bg-surface focus-ring">
                                                <Pencil size={12} /> Correct
                                            </button>
                                            <button onClick={() => handleForceClockOut(s)}
                                                className="px-3 py-1.5 rounded-[var(--r-md)] border border-hairline text-[11px] font-bold text-danger-fg uppercase tracking-wider hover:bg-danger-bg hover:border-danger-fg/30 transition-all flex items-center gap-1.5 shadow-sm bg-surface focus-ring">
                                                <LogOut size={12} /> Force Out
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Recent Shifts */}
            <div className="bg-surface rounded-card border border-hairline overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.04)]">
                <div className="px-5 py-4 border-b border-hairline bg-surface-muted/30">
                    <h2 className="text-sm font-extrabold text-ink">Recent Shifts</h2>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-surface-muted/30 border-b border-hairline">
                        <tr>
                            <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Staff</th>
                            <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden md:table-cell">Role</th>
                            <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider hidden md:table-cell">Date</th>
                            <th className="text-left px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">In/Out</th>
                            <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Hours</th>
                            <th className="text-center px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Status</th>
                            <th className="text-right px-5 py-4 text-[11px] font-bold text-ink-subtle uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                        {recent.map(s => (
                            <tr key={s.id} className="hover:bg-surface-muted/30 transition-colors">
                                <td className="px-5 py-4 font-extrabold text-ink">{getStaffName(s)}</td>
                                <td className="px-5 py-4 text-ink-subtle font-medium capitalize hidden md:table-cell">{getStaffRole(s)}</td>
                                <td className="px-5 py-4 text-ink-subtle font-medium tabular-nums hidden md:table-cell">{bsEnabled ? toNepaliDate(new Date(s.clock_in), 'MMMM DD, YYYY', 'en') : new Date(s.clock_in).toLocaleDateString()}</td>
                                <td className="px-5 py-4 text-ink-subtle font-bold tabular-nums">
                                    {new Date(s.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    {' → '}
                                    {s.clock_out ? new Date(s.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                </td>
                                <td className="px-5 py-4 text-right font-bold text-brand-500 tabular-nums">
                                    {s.hours_worked != null ? `${s.hours_worked.toFixed(1)}h` : '—'}
                                </td>
                                <td className="px-5 py-4 text-center">
                                    {s.is_approved ? (
                                        <span className="text-[11px] font-bold uppercase tracking-wider bg-success-bg/20 text-success-fg px-3 py-1 rounded-full border border-success-bg inline-block">Approved</span>
                                    ) : (
                                        <span className="text-[11px] font-bold uppercase tracking-wider bg-amber-50/50 text-amber-700/80 px-3 py-1 rounded-full border border-amber-200/50 inline-block">Pending</span>
                                    )}
                                </td>
                                <td className="px-5 py-4">
                                    <div className="flex items-center gap-2 justify-end">
                                        <button onClick={() => setCorrecting(s)}
                                            className="px-3 py-1.5 rounded-[var(--r-md)] border border-hairline text-[11px] font-bold text-ink-subtle uppercase tracking-wider hover:text-brand-500 hover:bg-brand-50 hover:border-brand-200 transition-all flex items-center gap-1.5 shadow-sm bg-surface focus-ring">
                                            <Pencil size={12} /> Correct
                                        </button>
                                        {!s.is_approved && (
                                            <button onClick={() => handleApprove(s)}
                                                className="px-3 py-1.5 rounded-[var(--r-md)] border border-hairline text-[11px] font-bold text-success-fg uppercase tracking-wider hover:bg-success-bg/20 hover:border-success-bg transition-all flex items-center gap-1.5 shadow-sm bg-surface focus-ring">
                                                <CheckCircle size={12} /> Approve
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {recent.length === 0 && (
                            <tr><td colSpan={7} className="px-5 py-12 text-center text-ink-muted font-bold text-sm">No completed shifts yet.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
