import { createSerwistRoute } from '@serwist/turbopack'

// Serves the service worker built from src/sw.ts. Path matches the official
// @serwist/turbopack example (app/serwist/[path]/route.ts) — the handler
// always sends `Service-Worker-Allowed: /`, so registering from
// /serwist/sw.js still gives the worker site-wide scope.
export const { GET, dynamic, dynamicParams, revalidate, generateStaticParams } = createSerwistRoute({
    swSrc: 'src/sw.ts',
    // Without this, Serwist defaults to esbuild-wasm, which isn't installed
    // (and adds WASM overhead this build environment doesn't need).
    useNativeEsbuild: true,
})
