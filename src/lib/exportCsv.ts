export interface CsvColumn {
    key: string
    label: string
}

/**
 * An additional table appended after the main one — e.g. a per-cashier
 * breakdown following a day's transaction statement — each with its own
 * column set. Optional everywhere it's threaded through so every existing
 * single-table caller is unaffected.
 */
export interface ExportSection {
    title?: string
    columns: CsvColumn[]
    rows: Record<string, unknown>[]
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
 *
 * `extraSections`, when given, appends further tables (each with its own
 * header row) beneath the main one — CSV rows are just comma-joined text
 * lines, so a differently-shaped table can follow directly, separated by a
 * blank line and an optional title line.
 */
export function downloadCsv(filename: string, columns: CsvColumn[], rows: Record<string, unknown>[], extraSections?: ExportSection[]): void {
    const header = columns.map(c => escapeCsvValue(c.label)).join(',')
    const lines = rows.map(row => columns.map(c => escapeCsvValue(row[c.key])).join(','))
    const blocks = [header, ...lines]

    for (const section of extraSections ?? []) {
        blocks.push('')
        if (section.title) blocks.push(escapeCsvValue(section.title))
        blocks.push(section.columns.map(c => escapeCsvValue(c.label)).join(','))
        section.rows.forEach(row => blocks.push(section.columns.map(c => escapeCsvValue(row[c.key])).join(',')))
    }

    const csv = blocks.join('\r\n')

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

function escapeHtml(value: unknown): string {
    const str = value === null || value === undefined ? '' : String(value)
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildExcelTable(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
    const header = columns.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')
    const body = rows
        .map(row => `<tr>${columns.map(c => `<td>${escapeHtml(row[c.key])}</td>`).join('')}</tr>`)
        .join('')
    return `<table border="1"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
}

/**
 * Downloads rows as a real Excel-openable file — an HTML table served with
 * the .xls MIME type, which Excel has natively opened this way for decades.
 * No SheetJS/exceljs dependency needed for a flat table like these reports.
 *
 * `extraSections`, when given, appends further `<table>` blocks beneath the
 * main one — same idea as `downloadCsv`'s extra sections.
 */
export function downloadExcel(filename: string, columns: CsvColumn[], rows: Record<string, unknown>[], extraSections?: ExportSection[]): void {
    let tables = buildExcelTable(columns, rows)
    for (const section of extraSections ?? []) {
        tables += '<br/>'
        if (section.title) tables += `<p><b>${escapeHtml(section.title)}</b></p>`
        tables += buildExcelTable(section.columns, section.rows)
    }

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8" />
<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
</head>
<body>${tables}</body>
</html>`

    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.xls') ? filename : `${filename}.xls`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
