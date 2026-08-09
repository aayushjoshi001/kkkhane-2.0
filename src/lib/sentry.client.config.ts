/**
 * Sentry Client-Side Configuration
 * Handles error tracking for browser/client errors and component crashes
 */

import * as Sentry from '@sentry/nextjs'

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN

export function initSentryClient() {
  if (!SENTRY_DSN) {
    console.warn('SENTRY_DSN not configured. Error tracking disabled.')
    return
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV,

    // Performance Monitoring: 10% in prod, 0 in dev (no local tracing overhead).
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,

    // Never print Sentry's verbose logger locally (the "Integration installed" /
    // "[Tracing] …" flood). Opt in explicitly with SENTRY_DEBUG=true.
    debug: process.env.SENTRY_DEBUG === 'true',

    // No session replay. `replaysSessionSampleRate`/`replaysOnErrorSampleRate`
    // used to be set here, but sample rates alone do nothing: since v8 the SDK
    // only records when `replayIntegration()` is passed in `integrations`, and
    // it is not one of the browser or Next.js defaults. So no replay was ever
    // captured, and rrweb was never in the bundle. Dropped rather than left to
    // read like a feature that exists. To actually turn it on, add the
    // integration — preferably through `Sentry.lazyLoadIntegration()` so the
    // recorder is fetched from the CDN instead of shipped to every page.

    // Security: Don't send personal data
    beforeSend(event) {
      // Remove sensitive data from errors
      if (event.request) {
        delete event.request.cookies
        delete event.request.headers
      }

      // Remove email/password from error messages
      if (event.message) {
        event.message = event.message.replace(
          /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
          '[EMAIL]'
        )
      }

      return event
    },

    // Only send errors in production
    enabled: process.env.NODE_ENV === 'production' || process.env.SENTRY_DEBUG === 'true',

    // Ignore known harmless errors
    ignoreErrors: [
      // Browser extensions
      'chrome-extension://',
      'moz-extension://',
      // Network errors (not our fault)
      'NetworkError',
      // Random spam
      'Can\'t find variable: ZiteReader',
      'jigsaw is not defined',
    ],
  })
}
