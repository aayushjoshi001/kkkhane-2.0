import { jsPDF } from 'jspdf'

export interface PdfColumn {
    key: string
    label: string
    align?: 'left' | 'right' | 'center'
}

/**
 * An additional table drawn after the main one, in the same document — e.g.
 * a per-cashier breakdown following a day's transaction statement. Kept
 * optional everywhere it's threaded through so every existing single-table
 * caller is unaffected.
 */
export interface PdfSection {
    title?: string
    columns: PdfColumn[]
    rows: Record<string, any>[]
    totalsRow?: Record<string, any>
}

/**
 * Calculates proportional column widths based on column contents/types
 * so description/detail columns get more space while date/numeric columns remain compact.
 */
function calculateColumnWidths(columns: PdfColumn[], contentWidth: number): number[] {
    const weights = columns.map(col => {
        const key = col.key.toLowerCase()
        const label = col.label.toLowerCase()
        if (key.includes('desc') || key.includes('detail') || key.includes('note') || label.includes('description')) return 3.5
        if (key.includes('name') || key.includes('title') || label.includes('name')) return 2.2
        if (key.includes('payment_type') || key.includes('type') || label.includes('type')) return 2.0
        if (key.includes('date') || key.includes('time') || label.includes('date')) return 1.8
        if (key.includes('balance') || key.includes('running') || label.includes('running')) return 2.3
        return 1.8
    })

    const totalWeight = weights.reduce((a, b) => a + b, 0)
    let allocated = 0
    const widths = weights.map((w, i) => {
        if (i === weights.length - 1) return contentWidth - allocated
        const width = Math.floor((w / totalWeight) * contentWidth)
        allocated += width
        return width
    })
    return widths
}

/**
 * Draws one table (optional section title, header, rows, optional totals
 * footer) onto `doc` starting at `startY`, paginating as needed. Returns the
 * y position just below what it drew, so a caller can chain another table
 * (or another `drawTable` call for a second section) right after it.
 */
function drawTable(
    doc: jsPDF,
    startY: number,
    columns: PdfColumn[],
    rows: Record<string, any>[],
    totalsRow: Record<string, any> | undefined,
    margin: number,
    contentWidth: number,
    maxPageY: number,
    sectionTitle?: string
): number {
    let y = startY

    if (sectionTitle) {
        if (y + 10 > maxPageY) {
            doc.addPage()
            y = margin + 5
        }
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(10.5)
        doc.setTextColor(17, 24, 39)
        doc.text(sectionTitle, margin, y)
        y += 6
    }

    const colWidths = calculateColumnWidths(columns, contentWidth)
    const padding = 1.5

    // A wide table (many narrow columns, e.g. a per-cashier breakdown) needs
    // smaller text so labels wrap into fewer lines instead of spilling past
    // their column into the next one. Both the header and body scale down
    // together so the two stay visually consistent.
    const scale = columns.length > 9 ? 0.72 : columns.length > 7 ? 0.85 : columns.length > 5 ? 0.94 : 1
    const headerFontSize = 8 * scale
    const bodyFontSize = 7.5 * scale
    const bodyLineSpacing = 3.2 * scale
    const headerLineSpacing = 3.4 * scale

    // Wraps every header label to its own column width (same approach as the
    // body cells below) so a long label like "Net Cash to Collect" breaks
    // onto a second line rather than overlapping the next column's header.
    const drawHeader = (currentY: number): number => {
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(headerFontSize)
        doc.setTextColor(31, 41, 55)

        const headerCellLines: string[][] = columns.map((col, idx) => {
            const availableWidth = colWidths[idx] - (padding * 2)
            return doc.splitTextToSize(col.label, availableWidth)
        })
        const maxLines = Math.max(1, ...headerCellLines.map(l => l.length))
        const headerBlockHeight = maxLines * headerLineSpacing + 3.5

        // Draw header background line, sized to fit however many lines the
        // longest wrapped label needs.
        doc.setFillColor(243, 244, 246)
        doc.rect(margin, currentY - 3.5, contentWidth, headerBlockHeight, 'F')

        let x = margin
        columns.forEach((col, idx) => {
            const width = colWidths[idx]
            const align = col.align || 'left'
            let drawX = x + padding
            if (align === 'right') drawX = x + width - padding
            else if (align === 'center') drawX = x + width / 2

            let textY = currentY
            headerCellLines[idx].forEach(line => {
                doc.text(line, drawX, textY, { align })
                textY += headerLineSpacing
            })
            x += width
        })

        const ruleY = currentY - 3.5 + headerBlockHeight
        doc.setLineWidth(0.3)
        doc.setDrawColor(209, 213, 219)
        doc.line(margin, ruleY, margin + contentWidth, ruleY)

        return ruleY + 3
    }

    // Draw Initial Header
    y = drawHeader(y)

    // Draw Rows
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(bodyFontSize)
    doc.setTextColor(55, 65, 81)
    doc.setLineWidth(0.1)
    doc.setDrawColor(229, 231, 235)

    rows.forEach((row, rowIndex) => {
        // Pre-calculate line height for each cell to know exact row height
        const cellWrappedLines: string[][] = columns.map((col, idx) => {
            const rawVal = row[col.key]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal)
            const availableWidth = colWidths[idx] - (padding * 2)
            return doc.splitTextToSize(val, availableWidth)
        })

        const maxLines = Math.max(1, ...cellWrappedLines.map(l => l.length))
        const lineSpacing = bodyLineSpacing
        const computedRowHeight = maxLines * lineSpacing + 3

        // Pagination Check
        if (y + computedRowHeight > maxPageY) {
            doc.addPage()
            y = margin + 5
            y = drawHeader(y)
            doc.setFont('Helvetica', 'normal')
            doc.setFontSize(bodyFontSize)
            doc.setTextColor(55, 65, 81)
        }

        // Draw Row Shading for zebra striping
        if (rowIndex % 2 === 1) {
            doc.setFillColor(249, 250, 251)
            doc.rect(margin, y - 2.5, contentWidth, computedRowHeight, 'F')
        }

        // Render Cells
        let x = margin
        columns.forEach((col, idx) => {
            const width = colWidths[idx]
            const lines = cellWrappedLines[idx]
            const align = col.align || 'left'

            let drawX = x + padding
            if (align === 'right') drawX = x + width - padding
            else if (align === 'center') drawX = x + width / 2

            let textY = y
            lines.forEach(line => {
                doc.text(line, drawX, textY, { align })
                textY += lineSpacing
            })

            x += width
        })

        // Draw Row Bottom Line
        y += computedRowHeight
        doc.setDrawColor(243, 244, 246)
        doc.line(margin, y - 2.5, margin + contentWidth, y - 2.5)
    })

    // Draw Totals Row (if present)
    if (totalsRow) {
        const totalCellLines: string[][] = columns.map((col, idx) => {
            const rawVal = totalsRow[col.key]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal)
            const availableWidth = colWidths[idx] - (padding * 2)
            return doc.splitTextToSize(val, availableWidth)
        })
        const maxLines = Math.max(1, ...totalCellLines.map(l => l.length))
        const computedRowHeight = maxLines * headerLineSpacing + 4

        if (y + computedRowHeight > maxPageY) {
            doc.addPage()
            y = margin + 5
            y = drawHeader(y)
        }

        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(headerFontSize)
        doc.setTextColor(17, 24, 39)

        // Top double line for totals
        doc.setLineWidth(0.4)
        doc.setDrawColor(31, 41, 55)
        doc.line(margin, y - 1, margin + contentWidth, y - 1)

        let x = margin
        columns.forEach((col, idx) => {
            const width = colWidths[idx]
            const lines = totalCellLines[idx]
            const align = col.align || 'left'

            let drawX = x + padding
            if (align === 'right') drawX = x + width - padding
            else if (align === 'center') drawX = x + width / 2

            let textY = y + 2.5
            lines.forEach(line => {
                doc.text(line, drawX, textY, { align })
                textY += headerLineSpacing
            })
            x += width
        })

        y += computedRowHeight
        doc.line(margin, y - 1, margin + contentWidth, y - 1)
    }

    return y
}

/**
 * Builds a clean, non-overlapping tabular PDF report in A4 size and returns the
 * jsPDF document — shared by `downloadPdf` (single-file save) and callers that
 * need the raw bytes instead, e.g. bundling several reports into one zip.
 *
 * `extraSections`, when given, draws further tables (each with its own
 * column set and optional totals row) beneath the main one in the same
 * document — e.g. a per-cashier breakdown following a day's statement.
 */
export function buildPdfDoc(
    title: string,
    subtitle: string,
    columns: PdfColumn[],
    rows: Record<string, any>[],
    totalsRow?: Record<string, any>,
    extraSections?: PdfSection[]
): jsPDF {
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
    const margin = 12
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const contentWidth = pageWidth - (margin * 2) // 186mm
    const maxPageY = pageHeight - 15

    let y = margin + 5

    // 1. Draw Title
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(17, 24, 39)
    doc.text(title, margin, y)
    y += 6

    // 2. Draw Subtitle (wrapped if long)
    if (subtitle) {
        doc.setFont('Helvetica', 'normal')
        doc.setFontSize(8.5)
        doc.setTextColor(100, 116, 139)
        const subLines = doc.splitTextToSize(subtitle, contentWidth)
        doc.text(subLines, margin, y)
        y += subLines.length * 4 + 3
    } else {
        y += 2
    }

    // 3. Draw the main table
    y = drawTable(doc, y, columns, rows, totalsRow, margin, contentWidth, maxPageY)

    // 4. Draw any extra sections (e.g. a per-cashier breakdown) below it
    for (const section of extraSections ?? []) {
        y += 8
        y = drawTable(doc, y, section.columns, section.rows, section.totalsRow, margin, contentWidth, maxPageY, section.title)
    }

    return doc
}

/**
 * Generates and downloads a clean, non-overlapping tabular PDF report in A4 size.
 */
export function downloadPdf(
    filename: string,
    title: string,
    subtitle: string,
    columns: PdfColumn[],
    rows: Record<string, any>[],
    totalsRow?: Record<string, any>,
    extraSections?: PdfSection[]
): void {
    const doc = buildPdfDoc(title, subtitle, columns, rows, totalsRow, extraSections)
    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
