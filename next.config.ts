import type { NextConfig } from 'next'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants'

/**
 * Content Security Policy.
 *
 * Next injects inline scripts to hydrate the page and xterm sets inline
 * styles, so 'unsafe-inline' is needed unless every response carries a nonce.
 * Even so the policy closes what matters here: no script or frame from
 * another origin, no plugin content, no form posted elsewhere, and requests
 * limited to this origin. WebSockets are allowed by scheme because older
 * Safari versions do not match 'self' against ws:// and the terminal would
 * not connect.
 */
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

export default function config(phase: string): NextConfig {
  const dev = phase === PHASE_DEVELOPMENT_SERVER
  // Only promised when the deployment says it is served over HTTPS: sent over
  // plain HTTP it is ignored, and a wrong promise would lock browsers out.
  const https = process.env.SSH_WEB_SECURE_COOKIES === 'true'

  return {
    reactStrictMode: true,
    poweredByHeader: false,
    // El servidor arranca desde server.ts, que ademas atiende el upgrade a
    // WebSocket. Por eso no se usa la salida "standalone".
    serverExternalPackages: ['ssh2'],
    // The application never uses next/image, but the optimisation endpoint
    // (/_next/image) is enabled by default and reachable without a session. It
    // has a history of serious flaws: with nothing to optimise, it is turned off.
    images: { unoptimized: true },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'Content-Security-Policy', value: contentSecurityPolicy(dev) },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'Referrer-Policy', value: 'no-referrer' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
            { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
            ...(https
              ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
              : []),
          ],
        },
      ]
    },
  }
}
