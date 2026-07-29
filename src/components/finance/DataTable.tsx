'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState'
import Select from '@/components/ui/Select'

export interface DataTableColumn<T> {
    key: string
    header: string
    render: (row: T) => ReactNode
    sortValue?: (row: T) => string | number
    align?: 'left' | 'right' | 'center'
    className?: string
}

export interface DataTableFilter<T> {
    key: string
    label: string
    options: { value: string; label: string }[]
    predicate: (row: T, value: string) => boolean
}

export interface DataTableProps<T> {
    columns: DataTableColumn<T>[]
    rows: T[]
    rowKey: (row: T) => string
    searchKeys?: (row: T) => string[]
    filters?: DataTableFilter<T>[]
    emptyIcon?: LucideIcon
    emptyTitle?: string
    emptyDescription?: string
    pageSize?: number
    onRowClick?: (row: T) => void
    actionsHeader?: string
    renderActions?: (row: T) => ReactNode
}

/** Generic list surface — search, filter dropdowns, sortable headers, pagination, empty state. */
export default function DataTable<T>({
    columns,
    rows,
    rowKey,
    searchKeys,
    filters,
    emptyIcon,
    emptyTitle = 'Nothing here yet',
    emptyDescription,
    pageSize = 10,
    onRowClick,
    actionsHeader,
    renderActions,
}: DataTableProps<T>) {
    const [search, setSearch] = useState('')
    const [activeFilters, setActiveFilters] = useState<Record<string, string>>({})
    const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null)
    const [page, setPage] = useState(1)

    const filtered = useMemo(() => {
        let out = rows
        if (search.trim() && searchKeys) {
            const q = search.trim().toLowerCase()
            out = out.filter((row) => searchKeys(row).some((v) => v?.toLowerCase().includes(q)))
        }
        if (filters) {
            for (const f of filters) {
                const val = activeFilters[f.key]
                if (val) out = out.filter((row) => f.predicate(row, val))
            }
        }
        if (sort) {
            const col = columns.find((c) => c.key === sort.key)
            if (col?.sortValue) {
                out = [...out].sort((a, b) => {
                    const av = col.sortValue!(a)
                    const bv = col.sortValue!(b)
                    const cmp = av < bv ? -1 : av > bv ? 1 : 0
                    return sort.dir === 'asc' ? cmp : -cmp
                })
            }
        }
        return out
    }, [rows, search, activeFilters, sort, filters, columns, searchKeys])

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize)

    const toggleSort = (key: string) => {
        setSort((prev) => (prev?.key === key ? (prev.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' }))
    }

    return (
        <div className="space-y-3">
            {(searchKeys || filters) && (
                <div className="flex flex-wrap items-center gap-2">
                    {searchKeys && (
                        <div className="relative flex-1 min-w-[200px]">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                            <input
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value)
                                    setPage(1)
                                }}
                                placeholder="Search..."
                                className="w-full pl-9 pr-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                            />
                        </div>
                    )}
                    {filters?.map((f) => (
                        <Select
                            key={f.key}
                            value={activeFilters[f.key] ?? ''}
                            onChange={(e) => {
                                setActiveFilters((prev) => ({ ...prev, [f.key]: e.target.value }))
                                setPage(1)
                            }}
                            className="px-3 py-2.5 border border-hairline-strong rounded-xl text-sm bg-surface text-ink-muted font-semibold focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                        >
                            <option value="">{f.label}</option>
                            {f.options.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </Select>
                    ))}
                </div>
            )}

            <div className="bg-surface rounded-[var(--radius-card)] border border-hairline overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-surface-muted/30">
                            <tr>
                                {columns.map((col) => (
                                    <th
                                        key={col.key}
                                        className={cn(
                                            'px-4 py-3 text-[11px] font-bold uppercase tracking-wide text-ink-subtle select-none whitespace-nowrap',
                                            col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                                            col.sortValue && 'cursor-pointer hover:text-ink',
                                        )}
                                        onClick={() => col.sortValue && toggleSort(col.key)}
                                    >
                                        <span className="inline-flex items-center gap-1">
                                            {col.header}
                                            {col.sortValue && sort?.key === col.key && (sort.dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                                        </span>
                                    </th>
                                ))}
                                {renderActions && (
                                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-ink-subtle whitespace-nowrap">
                                        {actionsHeader ?? 'Actions'}
                                    </th>
                                )}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-hairline">
                            {pageRows.length === 0 ? (
                                <tr>
                                    <td colSpan={columns.length + (renderActions ? 1 : 0)} className="px-4 py-10">
                                        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} compact />
                                    </td>
                                </tr>
                            ) : (
                                pageRows.map((row) => (
                                    <tr
                                        key={rowKey(row)}
                                        className={cn('transition-colors', onRowClick && 'cursor-pointer hover:bg-surface-muted/40')}
                                        onClick={() => onRowClick?.(row)}
                                    >
                                        {columns.map((col) => (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    'px-4 py-3',
                                                    col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                                                    col.className,
                                                )}
                                            >
                                                {col.render(row)}
                                            </td>
                                        ))}
                                        {renderActions && (
                                            <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                                                {renderActions(row)}
                                            </td>
                                        )}
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {filtered.length > pageSize && (
                    <div className="flex items-center justify-between border-t border-hairline px-4 py-3">
                        <p className="text-xs text-ink-subtle">
                            Page {page} of {totalPages} · {filtered.length} total
                        </p>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                disabled={page <= 1}
                                onClick={() => setPage((p) => p - 1)}
                                className="w-8 h-8 rounded-lg border border-hairline-strong flex items-center justify-center disabled:opacity-40 hover:bg-surface-muted"
                            >
                                <ChevronLeft size={14} />
                            </button>
                            <button
                                type="button"
                                disabled={page >= totalPages}
                                onClick={() => setPage((p) => p + 1)}
                                className="w-8 h-8 rounded-lg border border-hairline-strong flex items-center justify-center disabled:opacity-40 hover:bg-surface-muted"
                            >
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
