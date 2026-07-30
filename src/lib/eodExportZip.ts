// Builds the three end-of-day PDFs (EOD report, income & expenses, day book)
// from an EodExportBundle and downloads them as one zip. Runs client-side —
// jsPDF and JSZip both need the browser — so this is only ever called from
// BusinessSessionContext right after a successful close.

import JSZip from 'jszip'
import { buildPdfDoc, type PdfColumn } from './exportPdf'
import { DAY_BOOK_CATEGORY_LABELS, formatDayBookDescription, isDayBookSourceCash } from './dayBookFormat'
import { formatCurrency } from './utils'
import type { EodExportBundle } from './eodExportActions'
import type { EodReportNotes } from './reports'

function timeStr(iso: string) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kathmandu' })
}

function buildEodReportPdf(bundle: EodExportBundle) {
    const { eodReport, currency, currencySymbol, restaurantName, date } = bundle
    const fmt = (n: number) => formatCurrency(n, currency, currencySymbol)

    let notes: EodReportNotes | null = null
    try { notes = eodReport.notes ? JSON.parse(eodReport.notes) : null } catch { notes = null }

    const columns: PdfColumn[] = [
        { key: 'label', label: 'Metric' },
        { key: 'value', label: 'Value', align: 'right' },
    ]

    const rows: Record<string, string>[] = [
        { label: 'Total Orders', value: String(eodReport.total_orders) },
        { label: 'Total Revenue', value: fmt(eodReport.total_revenue) },
        { label: 'Net Revenue', value: fmt(eodReport.net_revenue) },
        { label: 'Total Tax', value: fmt(eodReport.total_tax) },
        { label: 'Total Tips', value: fmt(eodReport.total_tips) },
        { label: 'Total Discounts', value: fmt(eodReport.total_discounts) },
        { label: 'Average Order Value', value: fmt(eodReport.avg_order_value) },
        {},
        { label: 'Cash Total', value: fmt(eodReport.cash_total) },
        { label: 'Card / Other Total', value: fmt(eodReport.card_total) },
        {},
        { label: 'Total COGS', value: fmt(eodReport.total_cogs) },
        { label: 'Gross Profit', value: fmt(eodReport.gross_profit) },
        {},
        { label: 'Cancelled Orders', value: String(eodReport.total_cancelled) },
        { label: 'Refunded Orders', value: String(eodReport.total_refunds) },
        { label: 'Voided Orders', value: String(eodReport.total_voids) },
        { label: 'Cancellation Cost', value: fmt(eodReport.total_cancellation_cost) },
        { label: 'Unverified Orders', value: String(eodReport.unverified_orders) },
    ]

    if (notes) {
        rows.push({}, { label: 'Unique Customers', value: String(notes.uniqueCustomers) })
        rows.push({ label: 'Rush Hour', value: notes.rushHour })

        const paymentEntries = Object.entries(notes.paymentBreakdown || {})
        if (paymentEntries.length > 0) {
            rows.push({}, { label: 'PAYMENT BREAKDOWN', value: '' })
            for (const [method, amount] of paymentEntries) {
                rows.push({ label: method.charAt(0).toUpperCase() + method.slice(1), value: fmt(amount) })
            }
        }

        if (notes.topSellers?.length) {
            rows.push({}, { label: 'TOP SELLERS', value: '' })
            for (const item of notes.topSellers) {
                rows.push({ label: item.name, value: `${item.quantity} sold  ·  ${fmt(item.revenue)}` })
            }
        }
    }

    return buildPdfDoc('End of Day Report', `${restaurantName}  |  ${date}`, columns, rows)
}

function buildIncomeExpensesPdf(bundle: EodExportBundle) {
    const { financeSummary, incomeItems = [], expenseItems = [], restaurantName, date, currency, currencySymbol } = bundle
    const fmt = (n: number) => formatCurrency(n, currency, currencySymbol)

    const columns: PdfColumn[] = [
        { key: 'time', label: 'Time' },
        { key: 'category', label: 'Category & Details' },
        { key: 'by', label: 'Responsible Person' },
        { key: 'amount', label: 'Amount', align: 'right' },
    ]

    const rows: Record<string, string>[] = []

    // SECTION 1: TOTAL INCOME FIRST
    rows.push({ time: '', category: '=== SECTION 1: TOTAL INCOME ===', by: '', amount: '' })

    const incomeRows = incomeItems.map(item => ({
        time: timeStr(item.created_at),
        category: item.category_name + (item.description ? ` (${item.description})` : ''),
        by: item.created_by_name || 'Unknown',
        amount: '+' + fmt(item.amount),
    }))

    if (incomeRows.length > 0) {
        rows.push(...incomeRows)
    } else {
        const catRows = financeSummary.incomeByCategory.map(c => ({
            time: '—',
            category: c.name,
            by: '—',
            amount: '+' + fmt(c.amount),
        }))
        if (catRows.length > 0) {
            rows.push(...catRows)
        } else {
            rows.push({ time: '—', category: 'No income entries recorded for this date.', by: '—', amount: fmt(0) })
        }
    }
    rows.push({ time: '', category: 'TOTAL INCOME', by: '', amount: '+' + fmt(financeSummary.totalIncome) })
    rows.push({})

    // SECTION 2: TOTAL EXPENSES AFTER THAT
    rows.push({ time: '', category: '=== SECTION 2: TOTAL EXPENSES ===', by: '', amount: '' })

    const expenseRows = expenseItems.map(item => ({
        time: timeStr(item.created_at),
        category: item.category_name + (item.description ? ` (${item.description})` : ''),
        by: item.created_by_name || 'Unknown',
        amount: '-' + fmt(item.amount),
    }))

    if (expenseRows.length > 0) {
        rows.push(...expenseRows)
    } else {
        const catRows = financeSummary.expenseByCategory.map(c => ({
            time: '—',
            category: c.name,
            by: '—',
            amount: '-' + fmt(c.amount),
        }))
        if (catRows.length > 0) {
            rows.push(...catRows)
        } else {
            rows.push({ time: '—', category: 'No expense entries recorded for this date.', by: '—', amount: fmt(0) })
        }
    }
    rows.push({ time: '', category: 'TOTAL EXPENSES', by: '', amount: '-' + fmt(financeSummary.totalExpense) })

    const net = financeSummary.totalIncome - financeSummary.totalExpense
    const totalsRow = {
        time: '',
        category: 'NET SUMMARY (Income − Expense)',
        by: '',
        amount: (net >= 0 ? '+' : '-') + fmt(Math.abs(net)),
    }

    return buildPdfDoc(
        'Income & Expenses Statement',
        `${restaurantName}  |  ${date}  |  Income: ${fmt(financeSummary.totalIncome)}  |  Expense: ${fmt(financeSummary.totalExpense)}`,
        columns,
        rows,
        totalsRow,
    )
}

function buildDayBookPdf(bundle: EodExportBundle) {
    const { session, entries, restaurantName, date, currency, currencySymbol, financeSummary } = bundle
    const fmt = (n: number) => formatCurrency(n, currency, currencySymbol)

    const columns: PdfColumn[] = [
        { key: 'time', label: 'Time' },
        { key: 'source', label: 'Source' },
        { key: 'category', label: 'Category' },
        { key: 'description', label: 'Description' },
        { key: 'by', label: 'Responsible Person' },
        { key: 'in_amount', label: 'Money In (+)', align: 'right' },
        { key: 'out_amount', label: 'Money Out (-)', align: 'right' },
    ]

    const inEntries = entries.filter(e => e.type === 'cash_in' || e.type === 'bank_in')
    const outEntries = entries.filter(e => e.type === 'cash_out' || e.type === 'bank_out')

    const rows: Record<string, string>[] = []

    // SECTION 1: MONEY IN (LEFT COLUMN)
    rows.push({ time: '', source: '', category: '=== MONEY IN (CASH & BANK IN) ===', description: '', by: '', in_amount: '', out_amount: '' })
    if (inEntries.length > 0) {
        for (const e of inEntries) {
            rows.push({
                time: timeStr(e.created_at),
                source: isDayBookSourceCash(e.type) ? 'Cash' : 'Bank',
                category: DAY_BOOK_CATEGORY_LABELS[e.category] || e.category,
                description: formatDayBookDescription(e.description) + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
                by: e.created_by_name || 'Unknown',
                in_amount: '+' + fmt(e.amount),
                out_amount: '—',
            })
        }
    } else {
        rows.push({ time: '—', source: '—', category: 'No Money In entries', description: '—', by: '—', in_amount: fmt(0), out_amount: '—' })
    }
    const totalIn = financeSummary.cashIn + financeSummary.bankIn
    rows.push({ description: 'TOTAL MONEY IN', in_amount: '+' + fmt(totalIn), out_amount: '' })
    rows.push({})

    // SECTION 2: MONEY OUT (RIGHT COLUMN)
    rows.push({ time: '', source: '', category: '=== MONEY OUT (CASH & BANK OUT) ===', description: '', by: '', in_amount: '', out_amount: '' })
    if (outEntries.length > 0) {
        for (const e of outEntries) {
            rows.push({
                time: timeStr(e.created_at),
                source: isDayBookSourceCash(e.type) ? 'Cash' : 'Bank',
                category: DAY_BOOK_CATEGORY_LABELS[e.category] || e.category,
                description: formatDayBookDescription(e.description) + (e.bank_name ? ` (Bank: ${e.bank_name})` : ''),
                by: e.created_by_name || 'Unknown',
                in_amount: '—',
                out_amount: '-' + fmt(e.amount),
            })
        }
    } else {
        rows.push({ time: '—', source: '—', category: 'No Money Out entries', description: '—', by: '—', in_amount: '—', out_amount: fmt(0) })
    }
    const totalOut = financeSummary.cashOut + financeSummary.bankOut
    rows.push({ description: 'TOTAL MONEY OUT', in_amount: '', out_amount: '-' + fmt(totalOut) })
    rows.push({})

    // SECTION 3: BALANCES & SUMMARY
    rows.push({ time: '', source: '', category: '=== BALANCES & DAY BOOK SUMMARY ===', description: '', by: '', in_amount: '', out_amount: '' })

    const netChange = totalIn - totalOut
    const openingCombined = financeSummary.openingCash + financeSummary.openingBank
    const closingCombined = financeSummary.closingCash + financeSummary.closingBank

    rows.push(
        { description: 'Opening Cash Balance', in_amount: fmt(financeSummary.openingCash), out_amount: '' },
        { description: 'Opening Bank Balance', in_amount: fmt(financeSummary.openingBank), out_amount: '' },
        { description: 'Opening Balance (Cash + Bank)', in_amount: fmt(openingCombined), out_amount: '' },
        {},
        { description: 'Cash In Subtotal', in_amount: '+' + fmt(financeSummary.cashIn), out_amount: '' },
        { description: 'Bank In Subtotal', in_amount: '+' + fmt(financeSummary.bankIn), out_amount: '' },
        { description: 'Total Money In', in_amount: '+' + fmt(totalIn), out_amount: '' },
        {},
        { description: 'Cash Out Subtotal', in_amount: '', out_amount: '-' + fmt(financeSummary.cashOut) },
        { description: 'Bank Out Subtotal', in_amount: '', out_amount: '-' + fmt(financeSummary.bankOut) },
        { description: 'Total Money Out', in_amount: '', out_amount: '-' + fmt(totalOut) },
        {},
        { description: 'Net Day Change', in_amount: (netChange >= 0 ? '+' : '-') + fmt(Math.abs(netChange)), out_amount: '' },
        { description: 'Closing Cash Balance', in_amount: fmt(financeSummary.closingCash), out_amount: '' },
        { description: 'Closing Bank Balance', in_amount: fmt(financeSummary.closingBank), out_amount: '' },
    )

    const closingRow = { description: 'Closing Balance (Cash + Bank)', in_amount: fmt(closingCombined), out_amount: '' }
    const statusNote = session ? `Session status: ${session.status}` : 'No day book session was opened for this date.'

    return buildPdfDoc(
        'Day Book Statement',
        `${restaurantName}  |  ${date}  |  ${statusNote}`,
        columns,
        rows,
        closingRow,
    )
}

function filenameSafe(name: string): string {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'restaurant'
}

/**
 * Renders the EOD report, income & expenses summary, and day book statement
 * as A4 PDFs and downloads them zipped together as one file.
 */
export async function downloadEodZip(bundle: EodExportBundle): Promise<void> {
    const zip = new JSZip()
    zip.file(`EOD-Report-${bundle.date}.pdf`, buildEodReportPdf(bundle).output('arraybuffer'))
    zip.file(`Income-Expenses-${bundle.date}.pdf`, buildIncomeExpensesPdf(bundle).output('arraybuffer'))
    zip.file(`Day-Book-${bundle.date}.pdf`, buildDayBookPdf(bundle).output('arraybuffer'))

    const blob = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `EOD-${filenameSafe(bundle.restaurantName)}-${bundle.date}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
