'use client'

import { useEffect } from 'react'

/**
 * Registers the service worker that makes the application installable.
 *
 * Browsers only allow this in a secure context: HTTPS, or localhost. Served
 * over HTTP on a LAN address it is not, so nothing is registered there and the
 * application still works, just without being installable.
 */
export function InstallSupport() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Without a service worker the application still works in full.
      })
    }

    // Wait until the page has loaded so as not to compete with it.
    if (document.readyState === 'complete') {
      register()
      return
    }
    window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

  return null
}
