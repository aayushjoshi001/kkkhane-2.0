import { jsPDF } from 'jspdf'

export interface PdfColumn {
    key: string
    label: string
    align?: 'left' | 'right' | 'center'
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
 * Generates and downloads a clean, non-overlapping tabular PDF report in A4 size.
 */
export function downloadPdf(
    filename: string,
    title: string,
    subtitle: string,
    columns: PdfColumn[],
    rows: Record<string, any>[],
    totalsRow?: Record<string, any>
): void {
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

    // 3. Compute Column Widths
    const colWidths = calculateColumnWidths(columns, contentWidth)
    const padding = 1.5

    const drawHeader = (currentY: number): number => {
        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(31, 41, 55)

        // Draw header background line
        doc.setFillColor(243, 244, 246)
        doc.rect(margin, currentY - 3.5, contentWidth, 7, 'F')

        let x = margin
        columns.forEach((col, idx) => {
            const width = colWidths[idx]
            const align = col.align || 'left'
            let drawX = x + padding
            if (align === 'right') drawX = x + width - padding
            else if (align === 'center') drawX = x + width / 2

            doc.text(col.label, drawX, currentY, { align })
            x += width
        })

        doc.setLineWidth(0.3)
        doc.setDrawColor(209, 213, 219)
        doc.line(margin, currentY + 2.5, margin + contentWidth, currentY + 2.5)

        return currentY + 6.5
    }

    // Draw Initial Header
    y = drawHeader(y)

    // 4. Draw Rows
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(7.5)
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
        const lineSpacing = 3.2
        const computedRowHeight = maxLines * lineSpacing + 3

        // Pagination Check
        if (y + computedRowHeight > maxPageY) {
            doc.addPage()
            y = margin + 5
            y = drawHeader(y)
            doc.setFont('Helvetica', 'normal')
            doc.setFontSize(7.5)
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

    // 5. Draw Totals Row (if present)
    if (totalsRow) {
        const totalCellLines: string[][] = columns.map((col, idx) => {
            const rawVal = totalsRow[col.key]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal)
            const availableWidth = colWidths[idx] - (padding * 2)
            return doc.splitTextToSize(val, availableWidth)
        })
        const maxLines = Math.max(1, ...totalCellLines.map(l => l.length))
        const computedRowHeight = maxLines * 3.5 + 4

        if (y + computedRowHeight > maxPageY) {
            doc.addPage()
            y = margin + 5
            y = drawHeader(y)
        }

        doc.setFont('Helvetica', 'bold')
        doc.setFontSize(8)
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
                textY += 3.5
            })
            x += width
        })

        y += computedRowHeight
        doc.line(margin, y - 1, margin + contentWidth, y - 1)
    }

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
