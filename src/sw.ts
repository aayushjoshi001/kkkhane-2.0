/// <reference lib="webworker" />
import { Serwist } from 'serwist'
import { CacheFirst, NetworkFirst, NetworkOnly, ExpirationPlugin, CacheableResponsePlugin } from 'serwist'
import { defaultCache } from '@serwist/turbopack/worker'

declare const self: ServiceWorkerGlobalScope & {
    // Injected at build time — createSerwistRoute
    // (src/app/serwist/[path]/route.ts) esbuild-`define`-replaces this exact
    // identifier with the real manifest.
    __SW_MANIFEST: (string | { url: string; revision: string | null })[]
}

const serwist = new Serwist({
    precacheEntries: self.__SW_MANIFEST,
    // A new worker installs in the background and then *waits* — it does not
    // take over tabs that are already open.
    //
    // These were both true, which activated the new worker inside open tabs the
    // moment a deploy landed. That tab's JS was built against the previous asset
    // manifest, so its next lazy chunk request asked for a hashed URL the new
    // worker's precache no longer contains: ChunkLoadError, mid-order. The app
    // papered over it with a permanent "A new version is ready — Refresh" toast,
    // which put the problem in front of the user instead of fixing it.
    //
    // Waiting instead means an open tab keeps being served by the worker its own
    // code was built with, so there is no mismatch and nothing to warn about.
    // The trade-off: a tab left open indefinitely stays on the old version until
    // it is closed or reloaded — worth knowing for a kitchen display that runs
    // for days, which will need a manual refresh to pick up a deploy.
    skipWaiting: false,
    clientsClaim: false,
    navigationPreload: true,
    // Same offline fallback the old next-pwa config left unwired.
    fallbacks: {
        entries: [
            { url: '/offline.html', matcher: ({ request }) => request.destination === 'document' },
        ],
    },
    runtimeCaching: [
        // Kitchen, waiter & cashier pages — network only (must never show stale
        // order state).
        //
        // `cashier` was missing, so the billing screen was the one staff route
        // falling through to defaultCache, whose RSC entry is NetworkFirst: on a
        // flaky desk connection it replays a stored payload. That payload carries
        // the calendar the *previous* render read from the cookie, so the BS/AD
        // toggle — which works by writing the cookie and calling router.refresh()
        // — silently snaps back. Stale unpaid totals on a till are the worse half
        // of the same bug.
        {
            matcher: /^\/(kitchen|waiter|cashier)(\/|$)/i,
            handler: new NetworkOnly(),
        },
        // Menu & order status pages — network first with 10s timeout, fallback to cache
        {
            matcher: /^\/t\/.*/i,
            handler: new NetworkFirst({
                cacheName: 'customer-pages',
                networkTimeoutSeconds: 10,
                plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 3600 })],
            }),
        },
        // Admin pages — network first, short cache window
        {
            matcher: /^\/admin\/.*/i,
            handler: new NetworkFirst({
                cacheName: 'admin-pages',
                networkTimeoutSeconds: 10,
                plugins: [new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 300 })],
            }),
        },
        // Supabase Storage images — cache first, 24h TTL
        {
            matcher: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
            handler: new CacheFirst({
                cacheName: 'supabase-images',
                plugins: [
                    // CacheFirst otherwise caches whatever the first response is —
                    // including a transient 404/error or an opaque (status 0)
                    // response — and then serves that broken result for the full
                    // 24h TTL. Restricting to 200 means a failed load is retried
                    // next time instead of being pinned as a broken image.
                    new CacheableResponsePlugin({ statuses: [200] }),
                    new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 86400 }),
                ],
            }),
        },
        // Everything else Next.js itself needs cached (static assets, RSC payloads, etc.)
        ...defaultCache,
    ],
})

serwist.addEventListeners()
