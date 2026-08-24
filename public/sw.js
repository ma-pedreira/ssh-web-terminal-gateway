/*
 * ssh-web service worker.
 *
 * Deliberately conservative: this application gives SSH access to real
 * machines, so the only thing cached is the static build output, which carries
 * a hash in its file name and contains nothing belonging to the user.
 *
 * Everything else always goes to the network: pages, the API, the session and
 * the terminal. Caching an authenticated response would leave it within reach
 * of whoever uses that browser next.
 */

const CACHE = 'ssh-web-static-v1'

// Immutable only: Next puts a hash in every file name.
const IS_IMMUTABLE = (url) => url.pathname.startsWith('/_next/static/')

// Icons and manifest: they rarely change and carry no user data.
const IS_OWN_ASSET = (url) =>
  url.pathname.endsWith('.png') || url.pathname === '/manifest.webmanifest'

self.addEventListener('install', (event) => {
  // Takes over without waiting for old tabs to close.
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Nothing but a plain read gets past here.
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Another origin, the API or the terminal: always network, never cache.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (!IS_IMMUTABLE(url) && !IS_OWN_ASSET(url)) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      // Only successful responses from this same origin are stored.
      if (response.ok && response.type === 'basic') {
        cache.put(request, response.clone())
      }
      return response
    })(),
  )
})
