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
    skipWaiting: true,
    clientsClaim: true,
    navigationPreload: true,
    // Same offline fallback the old next-pwa config left unwired.
    fallbacks: {
        entries: [
            { url: '/offline.html', matcher: ({ request }) => request.destination === 'document' },
        ],
    },
    runtimeCaching: [
        // Kitchen & waiter pages — network only (must never show stale order state)
        {
            matcher: /^\/(kitchen|waiter)(\/|$)/i,
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
