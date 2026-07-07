'use client'

import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { DataTable, SectionTabs, type SectionTab } from '@/components/finance'
import type { AuditLog } from '@/types/database'

export default function AuditManager({ logs }: { logs: AuditLog[] }) {
    const [tab, setTab] = useState('all')

    const actions = Array.from(new Set(logs.map((l) => l.action))).sort()

    const tabs: SectionTab[] = [
        { key: 'all', label: 'Audit Trail', count: logs.length },
        { key: 'user_activity', label: 'User Activity' },
        { key: 'approval', label: 'Approval Logs' },
    ]

    const rows = tab === 'approval'
        ? logs.filter((l) => l.action.includes('approv') || l.action.includes('rejected'))
        : logs

    return (
        <div className="space-y-4">
            <SectionTabs tabs={tabs} active={tab} onChange={setTab} />
            <DataTable
                columns={[
                    { key: 'created_at', header: 'Date', render: (l) => new Date(l.created_at).toLocaleString(), sortValue: (l) => l.created_at },
                    { key: 'action', header: 'Action', render: (l) => l.action },
                    { key: 'entity_type', header: 'Entity', render: (l) => l.entity_type },
                    { key: 'entity_id', header: 'Entity ID', render: (l) => (l.entity_id ? <span className="font-mono text-xs">{l.entity_id.slice(0, 8)}…</span> : '—') },
                    { key: 'user_id', header: 'User', render: (l) => (l.user_id ? <span className="font-mono text-xs">{l.user_id.slice(0, 8)}…</span> : '—') },
                    { key: 'ip_address', header: 'IP', render: (l) => l.ip_address || <span className="text-ink-subtle">—</span> },
                ]}
                rows={rows}
                rowKey={(l) => l.id}
                searchKeys={(l) => [l.action, l.entity_type]}
                filters={actions.length ? [{ key: 'action', label: 'All actions', options: actions.map((a) => ({ value: a, label: a })), predicate: (row, value) => row.action === value }] : undefined}
                emptyIcon={ShieldCheck}
                emptyTitle="No audit activity yet"
                emptyDescription="Every action logged via the existing audit trail appears here. Finance-specific events will populate once the posting engine writes to it."
            />
        </div>
    )
}
