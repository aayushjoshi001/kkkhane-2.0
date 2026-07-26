import { jsPDF } from 'jspdf'

export interface PdfColumn {
    key: string
    label: string
    align?: 'left' | 'right' | 'center'
}

/**
 * Generates and downloads a tabular PDF report in A4 size.
 */
export function downloadPdf(
    filename: string,
    title: string,
    subtitle: string,
    columns: PdfColumn[],
    rows: Record<string, any>[],
    totalsRow?: Record<string, any>
): void {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' })
    const margin = 15
    const pageWidth = doc.internal.pageSize.getWidth()
    const contentWidth = pageWidth - (margin * 2) // 180mm

    // Draw Title
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(17, 17, 17)
    doc.text(title, margin, 20)

    // Draw Subtitle
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.text(subtitle, margin, 25)

    let y = 35
    const rowHeight = 8
    const colWidth = contentWidth / columns.length

    // Draw Header
    doc.setFont('Helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(0, 0, 0)
    columns.forEach((col, idx) => {
        const x = margin + (idx * colWidth)
        doc.text(col.label, x, y)
    })

    // Header Line
    doc.setLineWidth(0.4)
    doc.setDrawColor(0, 0, 0)
    doc.line(margin, y + 2, margin + contentWidth, y + 2)

    y += rowHeight

    // Draw Rows
    doc.setFont('Helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(50, 50, 50)
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.15)

    rows.forEach(row => {
        if (y > 280) {
            doc.addPage()
            y = 20
            // Redraw Header on new page
            doc.setFont('Helvetica', 'bold')
            columns.forEach((col, idx) => {
                const x = margin + (idx * colWidth)
                doc.text(col.label, x, y)
            })
            doc.line(margin, y + 2, margin + contentWidth, y + 2)
            y += rowHeight
            doc.setFont('Helvetica', 'normal')
        }

        columns.forEach((col, idx) => {
            const x = margin + (idx * colWidth)
            const rawVal = row[col.key]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal)
            doc.text(val, x, y)
        })

        doc.line(margin, y + 2, margin + contentWidth, y + 2)
        y += rowHeight
    })

    // Draw Totals Row
    if (totalsRow) {
        if (y > 280) {
            doc.addPage()
            y = 20
        }
        doc.setFont('Helvetica', 'bold')
        doc.setTextColor(0, 0, 0)
        columns.forEach((col, idx) => {
            const x = margin + (idx * colWidth)
            const rawVal = totalsRow[col.key]
            const val = rawVal === null || rawVal === undefined ? '' : String(rawVal)
            doc.text(val, x, y)
        })
        doc.setLineWidth(0.4)
        doc.setDrawColor(0, 0, 0)
        doc.line(margin, y - 5, margin + contentWidth, y - 5) // top line of footer
        doc.line(margin, y + 2, margin + contentWidth, y + 2) // bottom line of footer
    }

    doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}
