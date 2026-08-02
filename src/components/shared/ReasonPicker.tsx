'use client'

import { REASONS_BY_CONTEXT, KIND_LABEL, type CancellationKind, type ReasonContext } from '@/lib/voidReasons'

/**
 * The reason control shared by every write-off: the cashier's item cancel, the
 * cashier's whole-order cancel, and the manager's refund.
 *
 * One component rather than three so the three screens cannot drift into three
 * different vocabularies — the whole value of a reason code is that the same
 * event gets the same code wherever it is recorded.
 *
 * Codes are picked, notes are typed. The note is where the specifics go and
 * stays optional; the code is what a report groups by, so it is the one thing
 * the caller should require before enabling its confirm button.
 */
export default function ReasonPicker({
    context,
    onKindChange,
    code,
    onCodeChange,
    note,
    onNoteChange,
    notePlaceholder = 'Add detail (optional)',
    disabled,
}: {
    context: ReasonContext
    /** Pass to offer the Void/Comp switch. Omit on refunds, which are neither. */
    onKindChange?: (kind: CancellationKind) => void
    code: string | null
    onCodeChange: (code: string | null) => void
    note: string
    onNoteChange: (note: string) => void
    notePlaceholder?: string
    disabled?: boolean
}) {
    const options = REASONS_BY_CONTEXT[context]
    const showKindToggle = !!onKindChange && context !== 'refund'

    return (
        <div className="space-y-3">
            {showKindToggle && (
                <div>
                    <span className="text-[11px] font-extrabold text-ink-subtle uppercase tracking-wider block mb-1.5">
                        Type
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                        {(['void', 'comp'] as const).map(k => {
                            const active = context === k
                            return (
                                <button
                                    key={k}
                                    type="button"
                                    disabled={disabled}
                                    // Switching type clears the code: the two vocabularies
                                    // don't overlap, so a code carried across would be
                                    // dropped server-side and the reason silently lost.
                                    onClick={() => { onKindChange!(k); onCodeChange(null) }}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all disabled:opacity-50 ${
                                        active
                                            ? k === 'comp'
                                                ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                                                : 'bg-brand-500 border-brand-500 text-white shadow-sm'
                                            : 'bg-surface border-hairline text-ink-subtle hover:border-hairline-strong hover:text-ink'
                                    }`}
                                >
                                    {KIND_LABEL[k]}
                                    <span className="block text-[10px] font-semibold opacity-80 mt-0.5">
                                        {k === 'comp' ? 'Given free' : 'Taken off'}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            <div>
                <span className="text-[11px] font-extrabold text-ink-subtle uppercase tracking-wider block mb-1.5">
                    Reason <span className="text-danger-fg">*</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                    {options.map(opt => {
                        const active = code === opt.code
                        return (
                            <button
                                key={opt.code}
                                type="button"
                                disabled={disabled}
                                onClick={() => onCodeChange(active ? null : opt.code)}
                                title={opt.hint}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-50 ${
                                    active
                                        ? 'bg-ink border-ink text-canvas shadow-sm'
                                        : 'bg-surface border-hairline text-ink-subtle hover:border-hairline-strong hover:text-ink'
                                }`}
                            >
                                {opt.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            <input
                type="text"
                value={note}
                onChange={e => onNoteChange(e.target.value)}
                placeholder={notePlaceholder}
                maxLength={200}
                disabled={disabled}
                className="w-full px-3 py-2.5 border border-hairline rounded-xl text-xs font-semibold bg-surface placeholder:text-ink-subtle focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all disabled:opacity-50"
            />
        </div>
    )
}
