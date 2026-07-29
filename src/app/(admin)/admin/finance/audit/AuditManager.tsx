'use client'

import { useState } from 'react'
import { ShieldCheck, Activity, Edit2, Plus, MessageSquare } from 'lucide-react'
import { DataTable, SectionTabs, type SectionTab } from '@/components/finance'
import type { AuditLog } from '@/types/database'
import { useDateFormatter } from '@/lib/contexts/FeatureContext'
import { formatCurrency } from '@/lib/utils'

export default function AuditManager({ logs }: { logs: AuditLog[] }) {
    const [tab, setTab] = useState('all')
    const formatDate = useDateFormatter()

    const obLogs = logs.filter((l) => l.action.includes('opening_balance'))
    const approvalLogs = logs.filter((l) => l.action.includes('approv') || l.action.includes('rejected'))

    const actions = Array.from(new Set(logs.map((l) => l.action))).sort()

    const tabs: SectionTab[] = [
        { key: 'all', label: 'All Activities', count: logs.length },
        { key: 'opening_balance', label: 'Opening Balance Activities', count: obLogs.length },
        { key: 'approval', label: 'Approval Logs', count: approvalLogs.length },
    ]

    const rows = tab === 'opening_balance'
        ? obLogs
        : tab === 'approval'
        ? approvalLogs
        : logs

    const renderActionBadge = (action: string) => {
        if (action === 'opening_balance_added') {
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <Plus size={11} /> Added Opening Balance
                </span>
            )
        }
        if (action === 'opening_balance_edited') {
            return (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-amber-50 text-amber-800 border border-amber-200">
                    <Edit2 size={11} /> Edited Opening Balance
                </span>
            )
        }
        return <span className="font-semibold text-xs text-ink">{action}</span>
    }

    const renderDetails = (l: AuditLog) => {
        const isOb = l.action.includes('opening_balance')
        const newVal = (l.new_value || {}) as Record<string, any>
        const oldVal = (l.old_value || {}) as Record<string, any>

        const name = newVal.name || newVal.customer_name || newVal.supplier_name || oldVal.name || oldVal.customer_name || oldVal.supplier_name || '—'
        const reason = newVal.reason
        const newBal = newVal.opening_balance
        const oldBal = oldVal.opening_balance

        if (isOb) {
            return (
                <div className="space-y-1 py-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-ink">
                        <span>{name}</span>
                        <span className="text-ink-subtle">({l.entity_type.replace(/_/g, ' ')})</span>
                        {typeof newBal === 'number' && (
                            <span className="text-ink-subtle font-mono text-[11px]">
                                {typeof oldBal === 'number' ? `${formatCurrency(oldBal)} → ` : ''}
                                <strong className="text-ink">{formatCurrency(newBal)}</strong>
                            </span>
                        )}
                    </div>
                    {reason && (
                        <div className="flex items-start gap-1.5 p-2 bg-amber-50/60 border border-amber-200/80 rounded-xl text-xs text-amber-900 font-semibold max-w-lg">
                            <MessageSquare size={13} className="shrink-0 text-amber-600 mt-0.5" />
                            <div>
                                <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block">Reason Provided:</span>
                                <span>{reason}</span>
                            </div>
                        </div>
                    )}
                </div>
            )
        }

        return <span className="text-xs text-ink-subtle italic">No extra details</span>
    }

    return (
        <div className="space-y-6 animate-fade-up">
            <div className="bg-surface p-5 rounded-2xl border border-hairline shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center">
                        <Activity size={20} className="text-brand-500" />
                    </div>
                    <div>
                        <h1 className="text-xl font-extrabold text-ink tracking-tight">Manager Panel Activities</h1>
                        <p className="text-xs text-ink-subtle mt-0.5">
                            Complete activity log including mandatory reasons for opening balance additions & edits.
                        </p>
                    </div>
                </div>
            </div>

            <div className="space-y-4">
                <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
                <DataTable
                    columns={[
                        { key: 'created_at', header: 'Date & Time', render: (l) => formatDate(l.created_at), sortValue: (l) => l.created_at },
                        { key: 'action', header: 'Activity Action', render: (l) => renderActionBadge(l.action) },
                        { key: 'details', header: 'Activity Details & Edit Reason', render: (l) => renderDetails(l) },
                        { key: 'entity_type', header: 'Entity Category', render: (l) => <span className="capitalize font-semibold text-xs">{l.entity_type.replace(/_/g, ' ')}</span> },
                        { key: 'user_id', header: 'User ID', render: (l) => (l.user_id ? <span className="font-mono text-[11px] text-ink-subtle">{l.user_id.slice(0, 8)}…</span> : 'System') },
                        { key: 'ip_address', header: 'IP Address', render: (l) => l.ip_address || <span className="text-ink-subtle">—</span> },
                    ]}
                    rows={rows}
                    rowKey={(l) => l.id}
                    searchKeys={(l) => [l.action, l.entity_type, JSON.stringify(l.new_value || {})]}
                    filters={actions.length ? [{ key: 'action', label: 'Filter by action', options: actions.map((a) => ({ value: a, label: a })), predicate: (row, value) => row.action === value }] : undefined}
                    emptyIcon={ShieldCheck}
                    emptyTitle="No activity logged yet"
                    emptyDescription="Activities such as adding or editing ledger opening balances and audit events will appear here with reasons."
                />
            </div>
        </div>
    )
}
