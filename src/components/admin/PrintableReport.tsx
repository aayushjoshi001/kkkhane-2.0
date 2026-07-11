'use client'

import { forwardRef, useImperativeHandle } from 'react'

export interface PrintColumn {
    key: string
    label: string
    align?: 'left' | 'right' | 'center'
}

export interface PrintableReportHandle {
    print: () => void
}

interface PrintableReportProps {
    title: string
    subtitle?: string
    columns: PrintColumn[]
    rows: Record<string, unknown>[]
    totalsRow?: Record<string, unknown>
}

/**
 * Renders a ledger/report table for browser printing on A4 paper. Same
 * visibility-isolation technique as the receipt/KOT print fallbacks
 * (KotPrintFallback.tsx, CashierClient.tsx invoice print): sits off-screen
 * normally, and @media print hides everything else on the page so only this
 * shows when window.print() fires — sized for a full page report, not an
 * 80mm thermal receipt.
 */
const PrintableReport = forwardRef<PrintableReportHandle, PrintableReportProps>(function PrintableReport(
    { title, subtitle, columns, rows, totalsRow },
    ref
) {
    useImperativeHandle(ref, () => ({
        print: () => window.print()
    }))

    return (
        <div className="printable-report fixed" style={{ left: -10000, top: 0 }}>
            <style>{`
                @page { size: A4; margin: 14mm; }
                @media print {
                    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
                    body * { visibility: hidden !important; }
                    .printable-report, .printable-report * { visibility: visible !important; }
                    .printable-report {
                        position: absolute !important; left: 0 !important; top: 0 !important;
                        width: 100% !important;
                    }
                }
            `}</style>
            <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', width: '190mm' }}>
                <h1 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>{title}</h1>
                {subtitle && <p style={{ fontSize: 10, color: '#555', margin: '2px 0 0' }}>{subtitle}</p>}
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 10 }}>
                    <thead>
                        <tr>
                            {columns.map(c => (
                                <th key={c.key} style={{ textAlign: c.align || 'left', borderBottom: '2px solid #000', padding: '3px 6px', whiteSpace: 'nowrap' }}>
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => (
                            <tr key={i}>
                                {columns.map(c => (
                                    <td key={c.key} style={{ textAlign: c.align || 'left', borderBottom: '1px solid #ddd', padding: '3px 6px' }}>
                                        {row[c.key] as React.ReactNode ?? ''}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                    {totalsRow && (
                        <tfoot>
                            <tr>
                                {columns.map(c => (
                                    <td key={c.key} style={{ textAlign: c.align || 'left', borderTop: '2px solid #000', padding: '4px 6px', fontWeight: 700 }}>
                                        {totalsRow[c.key] as React.ReactNode ?? ''}
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>
        </div>
    )
})

export default PrintableReport
