// Normalises a QZ signing env var (certificate or private key) into a usable
// PEM string. Accepts either format so setup survives copy-paste:
//   1. Raw PEM (with -----BEGIN ... ----- lines). Some env editors turn real
//      newlines into the literal two-character sequence "\n" — we restore those.
//   2. Base64 of the whole PEM (a single line with no headers to drop and no
//      newlines to mangle) — the paste-safe option for dashboard entry.
// Returns null when unset or unparseable, which the routes treat as "signing
// not configured" (unsigned fallback).
export function loadPemEnv(raw: string | undefined): string | null {
    if (!raw) return null
    const v = raw.trim()
    if (!v) return null
    if (v.includes('-----BEGIN')) return v.replace(/\\n/g, '\n')
    try {
        const decoded = Buffer.from(v, 'base64').toString('utf8')
        return decoded.includes('-----BEGIN') ? decoded : null
    } catch {
        return null
    }
}
