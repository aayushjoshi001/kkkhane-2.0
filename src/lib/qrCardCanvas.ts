// Renders the branded, high-resolution QR card PNG shared by the admin
// Tables and Rooms pages (download button) — extracted so the ~150-line
// canvas-drawing routine exists in exactly one place instead of two files
// that had already drifted once (a "Powered by KKKHANEY" -> "KKKhane" fix
// landed in only one copy).

export interface QrCardOptions {
    /** Text shown in the orange banner (e.g. "T3" or "Room 101"), will be upper-cased. */
    label: string
    /** Restaurant/hotel name shown between the QR code and the footer. */
    restaurantName: string
    /** The already-rendered QR canvas (e.g. from a react-qr-code component) to composite in. */
    sourceCanvas: HTMLCanvasElement
    /** Path to the footer logo image. */
    logoSrc: string
}

/** Renders the branded QR card and returns a PNG data URL. */
export async function renderQrCardPng({ label, restaurantName, sourceCanvas, logoSrc }: QrCardOptions): Promise<string> {
    // Preload logo image
    const logoImg = new Image()
    logoImg.src = logoSrc
    await new Promise<void>((resolve) => {
        logoImg.onload = () => resolve()
        logoImg.onerror = () => resolve()
    })

    const baseWidth = 600
    const baseHeight = 650
    const scale = 3

    const exportCanvas = document.createElement('canvas')
    exportCanvas.width = baseWidth * scale
    exportCanvas.height = baseHeight * scale

    const ctx = exportCanvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get 2d canvas context')

    // 1. Draw the rounded white card with a hairline boundary, matching the
    // on-screen preview (rounded-xl + border-hairline-strong). Everything after
    // this is clipped to the rounded shape so the orange banners follow the
    // corners instead of poking out as square edges.
    const inset = 8 * scale
    const radius = 26 * scale
    const cardX = inset
    const cardY = inset
    const cardW = exportCanvas.width - inset * 2
    const cardH = exportCanvas.height - inset * 2

    const traceCardPath = () => {
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(cardX, cardY, cardW, cardH, radius)
        } else {
            // Fallback for older canvas engines without roundRect.
            ctx.moveTo(cardX + radius, cardY)
            ctx.arcTo(cardX + cardW, cardY, cardX + cardW, cardY + cardH, radius)
            ctx.arcTo(cardX + cardW, cardY + cardH, cardX, cardY + cardH, radius)
            ctx.arcTo(cardX, cardY + cardH, cardX, cardY, radius)
            ctx.arcTo(cardX, cardY, cardX + cardW, cardY, radius)
            ctx.closePath()
        }
    }

    // Transparent outside the card so the rounded corners stay clean.
    ctx.clearRect(0, 0, exportCanvas.width, exportCanvas.height)
    traceCardPath()
    ctx.save()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.clip()

    // Extract hashed font names from CSS variables created by next/font
    const outfitFont = typeof window !== 'undefined' ? window.getComputedStyle(document.body).getPropertyValue('--font-outfit').trim() || '"Outfit"' : '"Outfit"'
    const interFont = typeof window !== 'undefined' ? window.getComputedStyle(document.body).getPropertyValue('--font-inter').trim() || '"Inter"' : '"Inter"'
    const fontStack = `${outfitFont}, ${interFont}, system-ui, -apple-system, sans-serif`

    // 2. Draw Top Banner
    const orangeColor = '#ff7a00'

    // Thin horizontal line across the banner area (y = 55px)
    ctx.strokeStyle = orangeColor
    ctx.lineWidth = 4 * scale
    ctx.beginPath()
    ctx.moveTo(0, 55 * scale)
    ctx.lineTo(exportCanvas.width, 55 * scale)
    ctx.stroke()

    // Solid orange box in the center
    const boxWidth = 320
    const boxHeight = 50
    const boxX = (baseWidth - boxWidth) / 2
    const boxY = 30

    ctx.fillStyle = orangeColor
    ctx.fillRect(boxX * scale, boxY * scale, boxWidth * scale, boxHeight * scale)

    // Label inside the orange box
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${22 * scale}px ${fontStack}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
        label.toUpperCase(),
        exportCanvas.width / 2,
        (boxY + boxHeight / 2) * scale
    )

    // 3. Draw QR Code in the middle
    const qrSize = 340
    const qrX = (baseWidth - qrSize) / 2
    const qrY = 120
    ctx.drawImage(
        sourceCanvas,
        qrX * scale,
        qrY * scale,
        qrSize * scale,
        qrSize * scale
    )

    // 4. Draw Hotel/Restaurant Name (centered in the gap between QR and footer)
    ctx.fillStyle = '#000000'
    ctx.font = `bold ${26 * scale}px ${fontStack}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
        restaurantName,
        exportCanvas.width / 2,
        530 * scale
    )

    // 5. Draw Bottom Banner
    const footerHeight = 55
    const footerY = baseHeight - footerHeight

    ctx.fillStyle = orangeColor
    ctx.fillRect(0, footerY * scale, exportCanvas.width, footerHeight * scale)

    // Draw Footer Text "Powered by KKKhane"
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${16 * scale}px ${fontStack}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const footerText = 'Powered by KKKhane'
    const textCenterY = (footerY + footerHeight / 2) * scale

    const textWidth = ctx.measureText(footerText).width
    const logoSpacing = 10 * scale
    const logoRadius = 11 * scale
    const totalWidth = textWidth + logoSpacing + (logoRadius * 2)

    const textStartX = (exportCanvas.width - totalWidth) / 2 + textWidth / 2
    ctx.fillText(footerText, textStartX, textCenterY)

    // Draw Logo Icon next to text
    const logoCenterX = textStartX + textWidth / 2 + logoSpacing + logoRadius
    const logoCenterY = textCenterY

    // Draw circular logo image if preloaded successfully, fallback to styled white 'K' circle
    if (logoImg.complete && logoImg.naturalWidth > 0) {
        // Draw solid white background circle
        ctx.fillStyle = '#ffffff'
        ctx.beginPath()
        ctx.arc(logoCenterX, logoCenterY, logoRadius, 0, 2 * Math.PI)
        ctx.fill()

        ctx.save()
        ctx.beginPath()
        ctx.arc(logoCenterX, logoCenterY, logoRadius - (1.5 * scale), 0, 2 * Math.PI)
        ctx.closePath()
        ctx.clip()
        ctx.drawImage(
            logoImg,
            logoCenterX - logoRadius,
            logoCenterY - logoRadius,
            logoRadius * 2,
            logoRadius * 2
        )
        ctx.restore()

        // Draw white circle outline on top
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5 * scale
        ctx.beginPath()
        ctx.arc(logoCenterX, logoCenterY, logoRadius, 0, 2 * Math.PI)
        ctx.stroke()
    } else {
        // Draw white circle outline fallback
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2 * scale
        ctx.beginPath()
        ctx.arc(logoCenterX, logoCenterY, logoRadius, 0, 2 * Math.PI)
        ctx.stroke()

        // Draw white K letter inside the circle fallback
        ctx.fillStyle = '#ffffff'
        ctx.font = `bold ${12 * scale}px ${fontStack}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('K', logoCenterX, logoCenterY + 0.5 * scale)
    }

    // Release the rounded clip and stroke the hairline boundary on top.
    ctx.restore()
    traceCardPath()
    ctx.strokeStyle = '#DED8CF' // --border-strong (hairline-strong)
    ctx.lineWidth = 2 * scale
    ctx.stroke()

    return exportCanvas.toDataURL('image/png')
}

/** Triggers a browser download of a data URL under the given filename. */
export function downloadDataUrl(dataUrl: string, filename: string) {
    const downloadLink = document.createElement('a')
    downloadLink.download = filename
    downloadLink.href = dataUrl
    downloadLink.click()
}
