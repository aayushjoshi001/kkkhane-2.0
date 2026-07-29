// Signs a qz-tray challenge with the private key so QZ Tray trusts our print
// requests silently (no repeated Allow/Block prompt on every ticket). The
// private key never leaves the server — the browser POSTs the string QZ wants
// signed and gets back only the signature.
//
// Signature must match the algorithm set in qzClient.ts (SHA-512) and the
// certificate served by /api/qz/cert. When QZ_PRIVATE_KEY isn't configured we
// return an empty signature (HTTP 200), which qz-tray treats as "unsigned" —
// so deployments without QZ signing keep working exactly as before.
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { loadPemEnv } from '@/lib/print/qzKeys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
    const key = loadPemEnv(process.env.QZ_PRIVATE_KEY)
    if (!key) return new NextResponse('', { status: 200 })

    const body = await req.json().catch(() => null)
    const request = body?.request
    // qz-tray asks for a signature on connect (empty string) and on every call;
    // always sign whatever string it hands us, including the empty one.
    if (typeof request !== 'string') return new NextResponse('', { status: 400 })

    try {
        const signature = crypto.createSign('SHA512').update(request).sign(key, 'base64')
        return new NextResponse(signature, {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        })
    } catch {
        return new NextResponse('', { status: 500 })
    }
}
