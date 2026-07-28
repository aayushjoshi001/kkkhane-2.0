import { test, expect } from '@playwright/test'
import * as jspdfModule from 'jspdf'
import { downloadCsv, downloadExcel } from '../src/lib/exportCsv'
import { downloadPdf } from '../src/lib/exportPdf'

/**
 * The Day Book statement exports.
 *
 * These run without a browser page: the helpers only touch Blob/URL/document to
 * hand the finished file to the user, so the interesting part — how the rows
 * serialise — is reachable by shimming those three and capturing what would
 * have been downloaded.
 *
 * What is actually under test is the contract between DayBookClient and the
 * helpers. The client passes one array that mixes three row shapes: full entry
 * rows, `{}` spacers, and partial `{description, amount}` summary rows. A helper
 * that mishandles a missing key would drop the opening/closing balances, which
 * is the whole reason the statement is exportable.
 */

type Captured = { name: string; content: string }

const captured: Captured[] = []

function installDownloadShim() {
    const parts = new Map<string, string>()
    let seq = 0

    // Captures the text handed to each Blob, keyed by the object URL that the
    // anchor is then pointed at.
    class FakeBlob {
        _text: string
        constructor(chunks: unknown[]) {
            this._text = chunks.map(c => String(c)).join('')
        }
    }

    ;(globalThis as any).Blob = FakeBlob
    ;(globalThis as any).URL = {
        createObjectURL: (b: any) => {
            const url = `blob:fake/${seq++}`
            parts.set(url, b._text)
            return url
        },
        revokeObjectURL: () => {},
    }
    ;(globalThis as any).document = {
        createElement: () => ({ href: '', download: '', click() { captured.push({ name: this.download, content: parts.get(this.href) ?? '' }) } }),
        body: { appendChild: () => {}, removeChild: () => {} },
    }
}

installDownloadShim()

const columns = [
    { key: 'time', label: 'Time' },
    { key: 'source', label: 'Source' },
    { key: 'type', label: 'In/Out' },
    { key: 'category', label: 'Category' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount' },
]

// The long one is the banquet description from a real day — it exists to prove
// nothing clips it now that the PDF wraps text itself.
const LONG_DESC = 'Banquet hall booking balance for the Shrestha wedding reception, including service charge and extra chairs'

const statementRows: Record<string, unknown>[] = [
    { time: '08:05 AM', source: 'Cash', type: 'IN',  category: 'Order Payment',   description: 'Table 2 breakfast settlement', amount: '+4,300.00' },
    { time: '12:10 PM', source: 'Cash', type: 'IN',  category: 'Booking Payment', description: LONG_DESC,                      amount: '+15,750.00' },
    { time: '05:00 PM', source: 'Bank', type: 'OUT', category: 'Expense',         description: 'Supplier payment, Everest Beverages (Bank: Himalayan Bank)', amount: '-20,000.00' },
    {},
    { description: 'Opening Balance (Cash + Bank)', amount: '286,500.00' },
    {},
    { description: 'Total Money In',  amount: '+82,050.00' },
    { description: 'Total Money Out', amount: '-32,450.00' },
    {},
    { description: 'Closing Balance (Cash + Bank)', amount: '336,100.00' },
]

test.beforeEach(() => { captured.length = 0 })

test('CSV carries every entry and the opening/closing balances', async () => {
    downloadCsv('day-book-2026-07-28', columns, statementRows)

    expect(captured).toHaveLength(1)
    const { name, content } = captured[0]
    expect(name).toBe('day-book-2026-07-28.csv')

    // Excel needs the BOM to render Rs./Nepali text rather than mojibake.
    expect(content.startsWith('﻿')).toBe(true)
    expect(content).toContain('Time,Source,In/Out,Category,Description,Amount')

    // A statement without these cannot be reconciled — the point of the export.
    expect(content).toContain('Opening Balance (Cash + Bank),286,500.00'.replace('286,500.00', '"286,500.00"'))
    expect(content).toContain('"336,100.00"')
    expect(content).toContain('Total Money In')
    expect(content).toContain('Total Money Out')

    // The long description survives whole.
    expect(content).toContain(LONG_DESC)

    // A `{}` spacer must still emit a full-width blank line, not a short row,
    // or the columns shift under it in Excel.
    expect(content.split('\r\n')).toContain(',,,,,')

    // The description with a comma must be quoted rather than splitting a cell.
    expect(content).toContain('"Supplier payment, Everest Beverages (Bank: Himalayan Bank)"')
})

test('Excel export escapes markup and keeps the summary rows', async () => {
    downloadExcel('day-book-2026-07-28', columns, [
        ...statementRows,
        { description: '<script>alert(1)</script>', amount: '0.00' },
    ])

    expect(captured).toHaveLength(1)
    const { name, content } = captured[0]
    expect(name).toBe('day-book-2026-07-28.xls')

    expect(content).toContain('<th>Description</th>')
    expect(content).toContain('<td>Closing Balance (Cash + Bank)</td>')
    expect(content).toContain(`<td>${LONG_DESC}</td>`)

    // Escaped, so a description can never inject markup into the workbook.
    expect(content).toContain('&lt;script&gt;')
    expect(content).not.toContain('<script>')

    // Spacer rows still produce a full set of empty cells.
    expect(content).toContain('<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>')
})

test('PDF renders a multi-column statement without throwing on partial rows', async () => {

    // jsPDF assigns save() per instance rather than on the prototype, and its
    // real save() wants a browser to hand the file to. So the module export is
    // swapped for a subclass that re-assigns save() after construction —
    // exportPdf reads `jspdf.jsPDF` at call time, so it picks this up.
    let saved: { name: string; size: number } | null = null
    const mod = jspdfModule as unknown as { jsPDF: any }
    const RealPdf = mod.jsPDF

    class CapturingPdf extends RealPdf {
        constructor(...args: unknown[]) {
            super(...args)
            this.save = (filename?: string) => {
                saved = { name: String(filename), size: (this.output('arraybuffer') as ArrayBuffer).byteLength }
                return this
            }
        }
    }
    mod.jsPDF = CapturingPdf

    const pdfColumns = columns.map(c => ({ ...c, align: c.key === 'amount' ? ('right' as const) : ('left' as const) }))
    const render = (rows: Record<string, unknown>[], totals?: Record<string, unknown>) => {
        saved = null
        downloadPdf(
            'day-book-2026-07-28',
            'Day Book Statement',
            'Shrawan 13, 2083 (Jul 28, 2026)  |  Entries: 6  |  In: 82,050.00  |  Out: 32,450.00',
            pdfColumns,
            rows,
            totals,
        )
        return saved
    }

    let empty: { name: string; size: number } | null = null
    let full: { name: string; size: number } | null = null
    try {
        // A header-only document is the baseline: jsPDF emits ~3KB before a
        // single row is drawn, so an absolute size threshold would pass even if
        // every row were silently dropped.
        empty = render([])
        full = render(statementRows, { description: 'Closing Balance (Cash + Bank)', amount: '336,100.00' })
    } finally {
        mod.jsPDF = RealPdf
    }

    expect(full).not.toBeNull()
    expect(full!.name).toBe('day-book-2026-07-28.pdf')
    // The rows and the totals footer measurably added to the page.
    expect(full!.size).toBeGreaterThan(empty!.size + 500)
})
