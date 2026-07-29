/**
 * Generated fallback avatars.
 *
 * Most users have no `avatar_url`, so what actually renders in the nav and the
 * sidebars is a DiceBear-generated stand-in keyed off their name. Two things
 * about that URL constrain every caller, which is why they live here rather
 * than being re-derived at each `<Image>`:
 *
 *  - It's an SVG. next/image refuses to optimize SVG upstreams unless
 *    `dangerouslyAllowSVG` is set (it isn't — it would let any pasted https
 *    image URL through the optimizer as active content), so these must render
 *    with `unoptimized` or /_next/image answers 400.
 *  - `unoptimized` means the browser fetches api.dicebear.com directly, so the
 *    host has to be named in the CSP `img-src` in next.config.ts.
 *
 * A stored avatar_url is a real raster photo on Supabase storage and should
 * still go through the optimizer — hence `isGeneratedAvatar` rather than
 * unconditionally opting out.
 */

const DICEBEAR_HOST = 'https://api.dicebear.com'

/** DiceBear URL for `seed`. `backgroundColor` is a bare hex, no `#`. */
export function generatedAvatar(seed: string, backgroundColor = 'ff5a00'): string {
    return `${DICEBEAR_HOST}/9.x/notionists/svg?seed=${encodeURIComponent(seed || 'user')}&backgroundColor=${backgroundColor}`
}

/** True when `src` is a generated SVG avatar and must bypass the optimizer. */
export function isGeneratedAvatar(src: string): boolean {
    return src.startsWith(DICEBEAR_HOST)
}
