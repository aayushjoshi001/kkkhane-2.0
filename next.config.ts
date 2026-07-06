import type { NextConfig } from 'next'
import withPWAInit from 'next-pwa'
import { withSentryConfig } from '@sentry/nextjs'

const withPWA = withPWAInit({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  runtimeCaching: [
    // Static Next.js assets — cache first, long TTL
    {
      urlPattern: /^\/_next\/static\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 200, maxAgeSeconds: 86400 },
      },
    },
    // Supabase Storage images — cache first, 24h TTL
    {
      urlPattern: /^https:\/\/.*\.supabase\.co\/storage\/v1\/object\/public\/.*/i,
      handler: 'CacheFirst',
      options: {
        cacheName: 'supabase-images',
        expiration: { maxEntries: 100, maxAgeSeconds: 86400 },
      },
    },
    // Kitchen & waiter pages — network only (must never show stale order state)
    {
      urlPattern: /^\/(kitchen|waiter)(\/|$)/i,
      handler: 'NetworkOnly',
    },
    // Menu & order status pages — network first with 10s timeout, fallback to cache
    {
      urlPattern: /^\/t\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'customer-pages',
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
      },
    },
    // Admin pages — network first, short cache window
    {
      urlPattern: /^\/admin\/.*/i,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'admin-pages',
        networkTimeoutSeconds: 10,
        expiration: { maxEntries: 30, maxAgeSeconds: 300 },
      },
    },
  ],
})

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
              `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.supabase.co https://images.unsplash.com https://*.tile.openstreetmap.org",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://nominatim.openstreetmap.org",
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

const pwaConfig = withPWA(nextConfig as any)

// withSentryConfig uploads source maps at build time when SENTRY_AUTH_TOKEN is set.
// Skipped silently in dev/when token is absent.
const prodConfig = withSentryConfig(pwaConfig, {
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

// Completely bypass Webpack-based wrappers in development to maximize Turbopack speed
export default process.env.NODE_ENV === 'development' ? nextConfig : prodConfig
