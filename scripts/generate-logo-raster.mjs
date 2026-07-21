// One-off generator for src/lib/print/logoRaster.ts — packs the KKKhane "K"
// mark into a monochrome ESC/POS raster bitmap (GS v 0 format: row-major,
// MSB-first 1bpp, 1 = ink). Re-run this whenever the source logo changes:
//
//   node scripts/generate-logo-raster.mjs

import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '..', 'public', 'brand', 'kkkhane-k-logo.jpg')
const OUT = path.join(__dirname, '..', 'src', 'lib', 'print', 'logoRaster.ts')

// 192px is divisible by 8 (24 bytes/row) and prints at ~24mm wide on 80mm
// paper at 203dpi — a sensible footer size.
const SIZE = 192
const WIDTH_BYTES = SIZE / 8

// The logo is a solid-color mark (orange circle, white "K" cutout) on a
// white background — a plain luminance threshold would wash the orange out
// to near-background grey. Instead, treat "not close to white" as ink, which
// renders the mark as a solid silhouette (filled circle, white K hole),
// matching how single-color logos are conventionally rendered on thermal
// receipts.
const WHITE_DISTANCE_THRESHOLD = 40

async function main() {
    const { data, info } = await sharp(SRC)
        .resize(SIZE, SIZE, { fit: 'contain', background: '#ffffff' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })

    const channels = info.channels // 3 (RGB) — JPEG source, no alpha
    const packed = new Uint8Array(WIDTH_BYTES * SIZE)

    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            const idx = (y * SIZE + x) * channels
            const r = data[idx], g = data[idx + 1], b = data[idx + 2]
            const distanceFromWhite = (255 - r) + (255 - g) + (255 - b)
            const ink = distanceFromWhite > WHITE_DISTANCE_THRESHOLD
            if (ink) {
                const byteIndex = y * WIDTH_BYTES + (x >> 3)
                const bit = 0x80 >> (x & 7)
                packed[byteIndex] |= bit
            }
        }
    }

    const base64 = Buffer.from(packed).toString('base64')

    const out = `// GENERATED FILE — do not hand-edit.
// Regenerate via: node scripts/generate-logo-raster.mjs
// Packs public/brand/kkkhane-k-logo.jpg into a ${SIZE}x${SIZE} monochrome
// ESC/POS raster bitmap (GS v 0 format: row-major, MSB-first 1bpp, 1 = ink).

export const LOGO_WIDTH_BYTES = ${WIDTH_BYTES}
export const LOGO_HEIGHT_DOTS = ${SIZE}

const LOGO_BASE64 = '${base64}'

export const LOGO_RASTER: Uint8Array = Uint8Array.from(atob(LOGO_BASE64), c => c.charCodeAt(0))
`

    await writeFile(OUT, out, 'utf8')
    console.log(`Wrote ${OUT} (${packed.length} bytes packed, ${base64.length} base64 chars)`)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
