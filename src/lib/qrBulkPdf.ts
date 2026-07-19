// Bulk QR export: renders every room + table QR onto a multi-page A4 PDF using
// the exact same branded card as the single-download button (renderQrCardPng),
// laid out as a 2x3 grid so a venue can print all its QRs in one go.
//
// Client-only — uses <canvas> and triggers a browser download.
import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { renderQrCardPng } from './qrCardCanvas'

export interface QrCardItem {
    /** Banner text, e.g. "Room 101" or "T3". */
    label: string
    /** URL the QR encodes. */
    url: string
}

// Match the on-screen card's proportions (qrCardCanvas draws 600x650).
const CARD_ASPECT = 650 / 600 // height / width
const COLS = 2
const ROWS = 3
const MARGIN_MM = 12
const GAP_MM = 8

/** Loads an image for compositing, resolving to null on failure. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img)
        img.onerror = () => resolve(null)
        img.src = src
    })
}

/** High-error-correction QR onto its own canvas, to feed renderQrCardPng. */
async function makeQrCanvas(url: string, logoSrc: string): Promise<HTMLCanvasElement> {
    const canvas = document.createElement('canvas')
    // margin 0 matches the on-screen preview and single-PNG download, which use
    // qrcode.react's includeMargin={false}; the branded card supplies the quiet
    // zone via its white padding around the QR, so the codes stay scannable.
    await QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', margin: 0, width: 1024 })

    // Embed the KKKhane logo in the centre so the PDF matches the on-screen card
    // and the single-PNG download (both use qrcode.react's `imageSettings`, which
    // the plain `qrcode` package does not do — this was the missing piece). The
    // logo is ~26% of the QR on a small white excavated pad, comfortably inside
    // level-H error correction so the code still scans.
    const ctx = canvas.getContext('2d')
    if (ctx) {
        const logo = await loadImage(logoSrc)
        if (logo && logo.naturalWidth > 0) {
            const logoSize = Math.round(canvas.width * 0.26)
            const pad = Math.round(logoSize * 0.08)
            const pos = Math.round((canvas.width - logoSize) / 2)
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(pos - pad, pos - pad, logoSize + pad * 2, logoSize + pad * 2)
            ctx.drawImage(logo, pos, pos, logoSize, logoSize)
        }
    }
    return canvas
}

/**
 * Build and download a multi-page A4 PDF of branded QR cards.
 * Returns the number of cards rendered.
 */
export async function buildQrCardsPdf(
    items: QrCardItem[],
    opts: { restaurantName: string; logoSrc: string; fileName: string }
): Promise<number> {
    if (!items.length) return 0

    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()

    const cellW = (pageW - 2 * MARGIN_MM - (COLS - 1) * GAP_MM) / COLS
    const rowH = (pageH - 2 * MARGIN_MM - (ROWS - 1) * GAP_MM) / ROWS

    // Fit the card inside its cell while preserving the card's aspect ratio.
    let cardW = cellW
    let cardH = cardW * CARD_ASPECT
    if (cardH > rowH) {
        cardH = rowH
        cardW = cardH / CARD_ASPECT
    }

    const perPage = COLS * ROWS
    for (let i = 0; i < items.length; i++) {
        const slot = i % perPage
        if (i > 0 && slot === 0) pdf.addPage()

        const col = slot % COLS
        const row = Math.floor(slot / COLS)
        const cellX = MARGIN_MM + col * (cellW + GAP_MM)
        const cellY = MARGIN_MM + row * (rowH + GAP_MM)
        // Center the card in its cell.
        const x = cellX + (cellW - cardW) / 2
        const y = cellY + (rowH - cardH) / 2

        const sourceCanvas = await makeQrCanvas(items[i].url, opts.logoSrc)
        const png = await renderQrCardPng({
            label: items[i].label,
            restaurantName: opts.restaurantName,
            sourceCanvas,
            logoSrc: opts.logoSrc,
        })
        pdf.addImage(png, 'PNG', x, y, cardW, cardH)
    }

    pdf.save(opts.fileName)
    return items.length
}
