// Serves the public QZ Tray signing certificate to the browser so qz-tray can
// present it during the WebSocket handshake. Public by design — a certificate
// carries no secret (the private key lives only in /api/qz/sign's env). When
// QZ_CERTIFICATE isn't configured, respond 204 so the client falls back to
// unsigned mode (QZ shows its one-off Allow/Block prompt) instead of erroring.
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    const cert = process.env.QZ_CERTIFICATE?.replace(/\\n/g, '\n')
    if (!cert) return new NextResponse(null, { status: 204 })
    return new NextResponse(cert, {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
}
