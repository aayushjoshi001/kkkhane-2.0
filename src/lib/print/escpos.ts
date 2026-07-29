// Minimal ESC/POS command builder for 80mm thermal printers.
//
// Targets the standard Epson-compatible command subset that the vast majority
// of 80mm thermal printers (including the generic clones common in POS
// hardware) support: init, align, bold, double-size text, and paper cut.
// Text is plain ASCII/UTF-8 — no code-page switching, matching the existing
// receipts which already render amounts as "Rs." rather than a currency glyph.
//
// The cut command (GS V 0, full cut) is the one line most likely to need
// tweaking for a specific printer model — some expect `GS V 1` (partial cut)
// or `GS V 66 0` (feed + partial cut) instead.

/** Column width in characters for 80mm paper at the printer's default font (Font A, 42 cols). */
export const LINE_WIDTH = 42

const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

type Align = 'left' | 'center' | 'right'

const encoder = new TextEncoder()

/** UTF-8 byte length of a string — what the printer actually receives, not its JS .length. */
function byteLength(str: string): number {
    return encoder.encode(str).length
}

/** Truncate to a max UTF-8 byte width without splitting a multi-byte character. */
function truncateToByteWidth(str: string, maxBytes: number): string {
    if (byteLength(str) <= maxBytes) return str
    let result = ''
    for (const ch of str) {
        const next = result + ch
        if (byteLength(next) > maxBytes) break
        result = next
    }
    return result
}

/** Split a string into array of lines where each line's UTF-8 byte length <= maxBytes. */
export function wrapTextToByteWidth(str: string, maxBytes: number): string[] {
    if (!str || maxBytes <= 0) return ['']
    if (byteLength(str) <= maxBytes) return [str]

    const words = str.split(' ')
    const lines: string[] = []
    let current = ''

    for (const word of words) {
        if (!word) continue
        if (!current) {
            if (byteLength(word) <= maxBytes) {
                current = word
            } else {
                let remaining = word
                while (byteLength(remaining) > maxBytes) {
                    const chunk = truncateToByteWidth(remaining, maxBytes)
                    lines.push(chunk)
                    remaining = remaining.slice(chunk.length)
                }
                current = remaining
            }
        } else {
            const candidate = `${current} ${word}`
            if (byteLength(candidate) <= maxBytes) {
                current = candidate
            } else {
                lines.push(current)
                if (byteLength(word) <= maxBytes) {
                    current = word
                } else {
                    let remaining = word
                    while (byteLength(remaining) > maxBytes) {
                        const chunk = truncateToByteWidth(remaining, maxBytes)
                        lines.push(chunk)
                        remaining = remaining.slice(chunk.length)
                    }
                    current = remaining
                }
            }
        }
    }
    if (current) lines.push(current)
    return lines.length > 0 ? lines : ['']
}

export class EscPosBuilder {
    private bytes: number[] = []

    /** Reset the printer to its default state. Call first. */
    init(): this {
        this.bytes.push(ESC, 0x40)
        return this
    }

    align(align: Align): this {
        const n = align === 'center' ? 1 : align === 'right' ? 2 : 0
        this.bytes.push(ESC, 0x61, n)
        return this
    }

    bold(on: boolean): this {
        this.bytes.push(ESC, 0x45, on ? 1 : 0)
        return this
    }

    /** Double-height and/or double-width text via GS ! n (character size selector). */
    size(opts: { doubleHeight?: boolean; doubleWidth?: boolean } = {}): this {
        let n = 0
        if (opts.doubleHeight) n |= 0x01
        if (opts.doubleWidth) n |= 0x10
        this.bytes.push(GS, 0x21, n)
        return this
    }

    /** Append raw text (no trailing newline). */
    text(str: string): this {
        this.pushText(str)
        return this
    }

    /** Append text followed by a line feed. */
    line(str = ''): this {
        this.pushText(str)
        this.bytes.push(LF)
        return this
    }

    /** One or more blank line feeds. */
    feed(lines = 1): this {
        for (let i = 0; i < lines; i++) this.bytes.push(LF)
        return this
    }

    /** A full-width dashed divider. */
    divider(char = '-'): this {
        return this.line(char.repeat(LINE_WIDTH))
    }

    /**
     * A two-or-more-column row, each column padded/truncated to its width.
     * Mirrors the DESC / QTY / RATE / AMT columns on the existing HTML receipts.
     *
     * Width is measured in UTF-8 bytes, not JS string length — the printer
     * receives bytes (via TextEncoder in pushText), and any non-ASCII
     * character (accented names, etc.) encodes to more bytes than its
     * UTF-16 code-unit count, which would otherwise throw every column
     * after it out of alignment on the physical ticket.
     */
    columns(cols: { text: string; width: number; align?: Align }[]): this {
        const parts = cols.map(c => {
            const text = truncateToByteWidth(c.text, c.width)
            const pad = Math.max(0, c.width - byteLength(text))
            if (c.align === 'right') return ' '.repeat(pad) + text
            if (c.align === 'center') {
                const left = Math.floor(pad / 2)
                return ' '.repeat(left) + text + ' '.repeat(pad - left)
            }
            return text + ' '.repeat(pad)
        })
        return this.line(parts.join(''))
    }

    /**
     * Prints a multi-column row where the first column (e.g. description/dish name)
     * wraps across multiple lines if it exceeds its width, while subsequent
     * columns (QTY, RATE, AMT) are printed on the first line and padded on wrapped lines.
     */
    wrappedColumns(cols: { text: string; width: number; align?: Align }[]): this {
        if (cols.length === 0) return this
        const descCol = cols[0]
        const descLines = wrapTextToByteWidth(descCol.text, descCol.width)

        // First line: descLines[0] + all remaining columns
        const firstLineCols = [
            { text: descLines[0] || '', width: descCol.width, align: descCol.align },
            ...cols.slice(1)
        ]
        this.columns(firstLineCols)

        // Subsequent lines: remaining descLines + blank columns
        for (let i = 1; i < descLines.length; i++) {
            const subLineCols = [
                { text: descLines[i], width: descCol.width, align: descCol.align },
                ...cols.slice(1).map(c => ({ text: '', width: c.width, align: c.align }))
            ]
            this.columns(subLineCols)
        }

        return this
    }

    /**
     * Print a monochrome raster image via GS v 0 — the standard Epson raster
     * command, with the broadest support across generic 80mm clone printers.
     * `data` must be row-major, MSB-first packed 1bpp bits (1 = ink), with
     * `data.length === widthBytes * heightDots`.
     */
    image({ widthBytes, heightDots, data }: { widthBytes: number; heightDots: number; data: Uint8Array }): this {
        this.bytes.push(
            GS, 0x76, 0x30, 0x00,
            widthBytes & 0xff, (widthBytes >> 8) & 0xff,
            heightDots & 0xff, (heightDots >> 8) & 0xff,
        )
        for (let i = 0; i < data.length; i++) this.bytes.push(data[i])
        return this
    }

    /** Feed a few lines then cut the paper. Call last. */
    cut(): this {
        this.bytes.push(LF, LF, LF)
        this.bytes.push(GS, 0x56, 0x00) // full cut
        return this
    }

    build(): Uint8Array {
        return new Uint8Array(this.bytes)
    }

    private pushText(str: string) {
        const encoded = new TextEncoder().encode(str)
        for (let i = 0; i < encoded.length; i++) this.bytes.push(encoded[i])
    }
}

/** Base64-encode a byte array for transport over qz.print()'s `flavor: 'base64'`. */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
}
