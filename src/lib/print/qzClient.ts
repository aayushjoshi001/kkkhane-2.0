// Thin wrapper around the qz-tray client library: connects to the local QZ
// Tray desktop agent over WebSocket and sends raw ESC/POS bytes to a named
// printer. Client-side only — qz-tray touches `window`/WebSocket, so every
// export here must only ever be called from the browser (dynamic-imported).
//
// Unsigned mode: we don't call qz.security.setCertificatePromise/
// setSignaturePromise. qz-tray's own defaults already reject the cert
// handshake and resolve signatures as empty, which is exactly "run
// unsigned" — QZ Tray shows a one-time "Website wants to print — Allow/
// Block (remember this decision)" prompt on the desktop app instead of
// silently failing. To upgrade to a signed certificate later (fully silent,
// no prompt ever), set both security promises here to fetch/sign against a
// server endpoint — no other file in this feature needs to change.

import { bytesToBase64 } from './escpos'

export type QzStatus = 'connected' | 'not-running' | 'not-trusted' | 'print-failed'

export interface QzResult {
    ok: boolean
    status: QzStatus
    error?: string
}

let qzModule: typeof import('qz-tray').default | null = null

async function getQz() {
    if (qzModule) return qzModule
    const mod = await import('qz-tray')
    qzModule = mod.default
    return qzModule
}

function classifyError(err: unknown, fallback: QzStatus): QzStatus {
    const message = err instanceof Error ? err.message : String(err)
    if (/block/i.test(message)) return 'not-trusted'
    return fallback
}

// The browser's WebSocket has no built-in connect timeout — if the handshake
// hangs instead of failing outright (rare, but possible on a misconfigured
// network), this stops a caller (e.g. a cashier settling a bill) from
// waiting forever on a connection that will never resolve either way.
const CONNECT_TIMEOUT_MS = 5000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms)
        promise.then(
            (value) => { clearTimeout(timer); resolve(value) },
            (err) => { clearTimeout(timer); reject(err) }
        )
    })
}

/** Ensures an active QZ Tray connection, connecting if needed. */
export async function ensureConnected(): Promise<QzResult> {
    try {
        const qz = await getQz()
        if (qz.websocket.isActive()) return { ok: true, status: 'connected' }
        await withTimeout(qz.websocket.connect({ retries: 1, delay: 1 }), CONNECT_TIMEOUT_MS, 'Timed out connecting to QZ Tray')
        return { ok: true, status: 'connected' }
    } catch (err) {
        return { ok: false, status: 'not-running', error: err instanceof Error ? err.message : String(err) }
    }
}

/** Lists printer names known to the local QZ Tray agent. */
export async function listPrinters(): Promise<string[]> {
    const connect = await ensureConnected()
    if (!connect.ok) throw new Error(connect.error || 'QZ Tray is not running')

    const qz = await getQz()
    const found = await qz.printers.find()
    return Array.isArray(found) ? found : [found]
}

/** Sends raw ESC/POS bytes to a named printer. */
export async function printRawEscPos(printerName: string, bytes: Uint8Array): Promise<QzResult> {
    const connect = await ensureConnected()
    if (!connect.ok) return connect

    try {
        const qz = await getQz()
        const config = qz.configs.create(printerName)
        await qz.print(config, [
            { type: 'raw', format: 'command', flavor: 'base64', data: bytesToBase64(bytes) },
        ])
        return { ok: true, status: 'connected' }
    } catch (err) {
        const status = classifyError(err, 'print-failed')
        return { ok: false, status, error: err instanceof Error ? err.message : String(err) }
    }
}
