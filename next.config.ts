import type { NextConfig } from 'next'
import { withSerwist } from '@serwist/turbopack'
import { withSentryConfig } from '@sentry/nextjs'

// The restaurant's business day is Nepal Standard Time (UTC+5:45), but nothing
// pins the server process to it — left to whatever the deploy host defaults to
// (typically UTC). That mismatch is what causes "today" to roll over ~5h45m
// early in day-book sessions, EOD reports, and check-in/check-out parsing.
// Setting TZ here, before any Date is ever constructed, makes every bare
// (no-offset) Date string on the server resolve to NST instead.
process.env.TZ = 'Asia/Kathmandu'

// Replaces next-pwa, which never actually generated a service worker in this
// project — it only hooks in via Next's `webpack()` config function, which
// Turbopack (this project's bundler, `turbopack: {}` below) never calls.
// @serwist/turbopack instead compiles the worker with esbuild and serves it
// via a Route Handler (src/app/serwist/[path]/route.ts) — bundler-agnostic. The actual
// runtimeCaching/fallbacks config now lives in src/sw.ts, not here.

const isDev = process.env.NODE_ENV === 'development'

// A local Supabase stack is served from http://127.0.0.1:54321, which no
// production CSP source matches (`https://*.supabase.co` covers hosted projects
// only). Without this, every browser-side Supabase call — signOut(), Realtime —
// is blocked before it leaves the page and surfaces as `TypeError: Failed to
// fetch`. Derived from the env var rather than hardcoded so a non-default port
// still works, and only ever added in development.
const devSupabaseCsp = (() => {
  if (!isDev) return []
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return []
  try {
    const { origin, host, protocol } = new URL(url)
    // Hosted URLs are already covered by the *.supabase.co sources.
    if (host.endsWith('.supabase.co')) return []
    return [origin, `${protocol === 'https:' ? 'wss' : 'ws'}://${host}`]
  } catch {
    return []
  }
})()

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    // Negotiate modern formats — AVIF/WebP are typically 30-50% smaller than the
    // original JPEG/PNG. next/image already serves these responsively per `sizes`.
    formats: ['image/avif', 'image/webp'],
    // Optimized images are immutable per source URL; cache them at the edge for a day.
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      // Restaurants can paste an arbitrary external image URL for menu items
      // (MenuManager "URL" mode), so any https host must be allowed. Images are
      // proxied through the same-origin /_next/image optimizer, so CSP img-src
      // ('self') still covers the rendered output. https-only to avoid mixed content.
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(self)' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-eval' is only needed by the dev/HMR runtime — never ship it to prod.
              `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://*.tile.openstreetmap.org",
              // QZ Tray (thermal printer bridge) runs a local WebSocket server on the
              // till/kitchen device itself, port-scanning 8181-8185. It also connects
              // via the localhost.qz.io hostname (resolves to loopback) so a page
              // served over HTTPS can open a "secure" wss:// handshake to it without
              // being blocked as mixed content — both host forms need to be allowed.
              ["connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org https://challenges.cloudflare.com ws://localhost:* wss://localhost:* ws://localhost.qz.io:* wss://localhost.qz.io:*", ...devSupabaseCsp].join(' '),
              "font-src 'self' https://fonts.gstatic.com",
              "media-src 'self' blob:",
              "frame-src 'self' https://challenges.cloudflare.com",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion', '@marsidev/react-turnstile'],
  },
  turbopack: {},
}

const serwistConfig = withSerwist(nextConfig)

// withSentryConfig uploads source maps at build time when SENTRY_AUTH_TOKEN is set.
// Skipped silently in dev/when token is absent.
const prodConfig = withSentryConfig(serwistConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // `disableLogger` and `automaticVercelMonitors` are deprecated and are no-ops
  // under Turbopack — their replacements live under the build-tool plugin options.
  bundleSizeOptimizations: {
    excludeDebugStatements: true, // replaces disableLogger (tree-shakes Sentry logs)
  },
})

// Sentry's source-map upload is webpack-based and slow/unnecessary in dev.
// Serwist itself is Turbopack-native (no webpack involved, see src/sw.ts),
// so — unlike the old next-pwa setup — it's applied in both branches.
export default process.env.NODE_ENV === 'development' ? serwistConfig : prodConfig
