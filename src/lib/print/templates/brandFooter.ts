// Shared "Powered by KKKhane" footer, appended to every printed ticket
// (invoice and KOT/BOT) right before the paper cut.

import { EscPosBuilder } from '../escpos'
import { LOGO_WIDTH_BYTES, LOGO_HEIGHT_DOTS, LOGO_RASTER } from '../logoRaster'

export function appendBrandFooter(b: EscPosBuilder): void {
    b.align('center')
    b.feed(1)
    b.image({ widthBytes: LOGO_WIDTH_BYTES, heightDots: LOGO_HEIGHT_DOTS, data: LOGO_RASTER })
    b.line('Powered by KKKhane')
}
