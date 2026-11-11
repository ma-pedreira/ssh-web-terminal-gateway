import type { NextConfig } from 'next'

const config: NextConfig = {
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
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

export default config
