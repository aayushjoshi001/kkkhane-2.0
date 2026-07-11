export interface CsvColumn {
    key: string
    label: string
}

// Escapes a value for CSV: wraps in quotes (doubling any inner quotes) only
// when it contains a comma, quote, or newline — keeps plain cells unquoted.
function escapeCsvValue(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value)
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

/**
 * Downloads rows as a CSV file. Prefixes a UTF-8 BOM so Excel (the realistic
 * target for a manager's export) renders Rs./Nepali text correctly instead of
 * mojibake, which plain UTF-8 CSV without a BOM triggers in Excel specifically.
 */
export function downloadCsv(filename: string, columns: CsvColumn[], rows: Record<string, unknown>[]): void {
    const header = columns.map(c => escapeCsvValue(c.label)).join(',')
    const lines = rows.map(row => columns.map(c => escapeCsvValue(row[c.key])).join(','))
    const csv = [header, ...lines].join('\r\n')

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
