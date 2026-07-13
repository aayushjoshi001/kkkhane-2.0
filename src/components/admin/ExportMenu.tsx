'use client'

import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, FileSpreadsheet, FileText, FileType } from 'lucide-react'

/**
 * A dropdown "Export" button offering CSV, Excel, and PDF, so callers don't
 * need three separate buttons for what's conceptually one action. PDF export
 * reuses whatever print handler the caller passes (typically PrintableReport's
 * window.print(), which lets the user "Save as PDF" — there's no PDF-generation
 * library in this project, and the browser's own print-to-PDF produces a more
 * faithfully laid-out document than manually rebuilding the table in a PDF lib).
 */
export default function ExportMenu({
    onExportCsv,
    onExportExcel,
    onExportPdf,
    className,
}: {
    onExportCsv: () => void
    onExportExcel: () => void
    onExportPdf: () => void
    className?: string
}) {
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!open) return
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    return (
        <div ref={ref} className={`relative ${className || ''}`}>
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 font-bold rounded-xl text-[10px] uppercase tracking-wider border border-gray-200 transition-all"
            >
                <Download size={13} /> Export <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-xl shadow-lg z-20 overflow-hidden">
                    <button
                        onClick={() => { onExportCsv(); setOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        <FileText size={13} /> CSV
                    </button>
                    <button
                        onClick={() => { onExportExcel(); setOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100"
                    >
                        <FileSpreadsheet size={13} /> Excel
                    </button>
                    <button
                        onClick={() => { onExportPdf(); setOpen(false) }}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-xs font-bold text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-100"
                    >
                        <FileType size={13} /> PDF
                    </button>
                </div>
            )}
        </div>
    )
}
