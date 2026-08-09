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

// Where to send bytes: a named OS printer (USB, per-device) or a raw network
// socket (host:port, restaurant-level config). QZ Tray still does the actual
// send in both cases — the cloud server can't reach a LAN printer directly.
export type PrinterTarget = string | { host: string; port: number }

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

// Everything that can stop a till connecting reports the same 'not-running',
// which is only one of the reasons and usually not the right one. A machine
// whose DNS cannot resolve localhost.qz.io, one missing override.crt so the
// trust dialog is sat waiting for a click, one with 8181 firewalled and one
// where QZ genuinely is not open all show the cashier the same red banner —
// and the reason is thrown away, so the till cannot tell anyone which it is.
// That is the whole difficulty of a printer that works on two machines and
// not on a third. The status stays as it was (callers switch on it), but the
// reason is written to the console under a tag worth screenshotting.
function reportConnectFailure(err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    // qz-tray tries wss://localhost then wss://localhost.qz.io. From an https
    // page the ws:// fallback is mixed content and the browser refuses it, so
    // localhost.qz.io resolving is what the secure handshake rests on.
    const hint = /timed out/i.test(message)
        ? 'Connect timed out. QZ Tray may be showing an unanswered Allow/Block dialog — install override.crt on this machine to make it silent.'
        : 'Could not open wss://localhost:8181 or wss://localhost.qz.io:8181. Check QZ Tray is running, that this machine resolves localhost.qz.io to 127.0.0.1 (add it to the hosts file if not), and that 8181 is not firewalled.'
    console.warn(`[QZ] connect failed on this device: ${message}\n[QZ] ${hint}`)
}

// The browser's WebSocket has no built-in connect timeout — if the handshake
// hangs instead of failing outright (rare, but possible on a misconfigured
// network), this stops a caller (e.g. a cashier settling a bill) from
// waiting forever on a connection that will never resolve either way.
//
// This is a backstop for a *hang*, not how we detect "QZ Tray isn't running":
// nothing listening on the port refuses the connection immediately, so
// qz.websocket.connect() rejects on its own long before this fires. Raising
// the ceiling therefore costs a till without QZ nothing.
//
// It has to clear the SLOW trust path, not just the fast one. QZ only reads
// the first certificate in its override.crt, and this install carries another
// tenant's cert in that slot, so ours falls through to the "user previously
// allowed" (allowed.dat) route — which spins up the dialog machinery, and Gtk
// is broken on the till, so each authorization stalls before auto-allowing.
// Measured on the real hardware: ~4.2s to connect, then ~1.5s per print,
// against an actual print of 0.03–0.3s. At the old 1500ms every connect timed
// out, printRawEscPos bailed before sending, and tickets diverted to the
// window.print() fallback — which cannot render to a raw CUPS queue, so
// nothing came out at all. 10s clears 4.2s with room for a cold JVM.
const CONNECT_TIMEOUT_MS = 10_000

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms)
        promise.then(
            (value) => { clearTimeout(timer); resolve(value) },
            (err) => { clearTimeout(timer); reject(err) }
        )
    })
}

// Shared in-flight connect. A single screen can hold several printer roles at
// once — the cashier has invoice, kot and bot — and they all reach for the
// socket together on mount. Without this each one sees isActive() === false,
// each calls connect(), and qz-tray races several handshakes for one agent.
// Everyone awaits the same attempt instead, and the slow trust path is walked
// exactly once.
let connecting: Promise<QzResult> | null = null

/** Ensures an active QZ Tray connection, connecting if needed. */
export async function ensureConnected(): Promise<QzResult> {
    try {
        const qz = await getQz()
        if (qz.websocket.isActive()) return { ok: true, status: 'connected' }
        if (connecting) return connecting
        connecting = withTimeout(qz.websocket.connect({ retries: 1, delay: 1 }), CONNECT_TIMEOUT_MS, 'Timed out connecting to QZ Tray')
            .then<QzResult, QzResult>(
                () => ({ ok: true, status: 'connected' }),
                (err) => {
                    reportConnectFailure(err)
                    return { ok: false, status: 'not-running' as const, error: err instanceof Error ? err.message : String(err) }
                }
            )
            // Clear only after the attempt settles, so callers arriving mid-flight
            // join it and the next one after it starts fresh.
            .finally(() => { connecting = null })
        return connecting
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

/**
 * Sends raw ESC/POS bytes to a printer. `target` is either a named OS printer
 * (USB) or a `{ host, port }` network printer — QZ Tray raw-sockets to the
 * latter over TCP (port 9100 for most thermal printers). `copies` reprints the
 * same bytes N times (a second KOT for the line, etc.).
 */
export async function printRawEscPos(target: PrinterTarget, bytes: Uint8Array, copies = 1): Promise<QzResult> {
    const connect = await ensureConnected()
    if (!connect.ok) return connect

    try {
        const qz = await getQz()
        const config = typeof target === 'string'
            ? qz.configs.create(target)
            : qz.configs.create({ host: target.host, port: target.port })
        const data = [{ type: 'raw' as const, format: 'command' as const, flavor: 'base64' as const, data: bytesToBase64(bytes) }]
        const runs = Math.min(9, Math.max(1, Math.round(copies)))
        for (let i = 0; i < runs; i++) {
            await qz.print(config, data)
        }
        return { ok: true, status: 'connected' }
    } catch (err) {
        const status = classifyError(err, 'print-failed')
        return { ok: false, status, error: err instanceof Error ? err.message : String(err) }
    }
}
