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

// Wire qz-tray's certificate + signature promises to our server endpoints so
// QZ Tray trusts this site silently instead of prompting Allow/Block on every
// print. The private key stays server-side (/api/qz/sign); the browser only
// ever fetches the public cert and per-request signatures.
//
// Fully silent printing also needs the matching public certificate installed
// as `override.crt` in the QZ Tray desktop app's install dir — without it QZ
// still recognises the signature but shows its trust prompt once. If the
// signing env vars aren't set, /api/qz/cert 204s: the cert promise rejects and
// qz-tray falls back to unsigned mode (one-off prompt), same as before.
function configureSecurity(qz: typeof import('qz-tray').default) {
    if (typeof qz.security.setSignatureAlgorithm === 'function') {
        qz.security.setSignatureAlgorithm('SHA512')
    }
    qz.security.setCertificatePromise((resolve: (v: string) => void, reject: (e?: unknown) => void) => {
        fetch('/api/qz/cert', { cache: 'no-store' })
            .then((r) => {
                if (!r.ok) { reject(); return null }
                return r.text()
            })
            .then((text) => { if (text) resolve(text); else reject() })
            .catch(reject)
    })
    qz.security.setSignaturePromise((toSign: string) => (resolve: (v: string) => void, reject: (e?: unknown) => void) => {
        fetch('/api/qz/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ request: toSign }),
        })
            .then((r) => r.text())
            .then(resolve)
            .catch(reject)
    })
}

async function getQz() {
    if (qzModule) return qzModule
    const mod = await import('qz-tray')
    qzModule = mod.default
    configureSecurity(qzModule)
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
// A real, running QZ Tray agent answers in well under a second, so this only
// needs to be long enough to absorb that — not long enough to make settling
// a bill visibly hang when the till simply doesn't have QZ Tray open.
const CONNECT_TIMEOUT_MS = 1500

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
