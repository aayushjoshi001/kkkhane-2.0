// Leaflet's default marker icon references image URLs that don't survive
// bundling. The commonly-copied fix hotlinks cdnjs.cloudflare.com, but that's
// a third-party runtime dependency and gets blocked by this app's CSP
// img-src allowlist. Self-hosting the same icons from /public avoids both
// problems — same-origin, always allowed, no external dependency.
export function fixLeafletDefaultIcon() {
    import('leaflet').then(L => {
        delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
        L.Icon.Default.mergeOptions({
            iconRetinaUrl: '/leaflet/marker-icon-2x.png',
            iconUrl: '/leaflet/marker-icon.png',
            shadowUrl: '/leaflet/marker-shadow.png',
        })
    })
}
