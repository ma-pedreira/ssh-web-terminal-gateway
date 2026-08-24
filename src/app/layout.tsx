import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { InstallSupport } from '@/components/ui/InstallSupport'
import './globals.css'

export const metadata: Metadata = {
  title: 'ssh-web',
  description: 'SSH access from the browser with sessions that survive',
  applicationName: 'ssh-web',
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // iOS does not read the manifest: it needs these separate hints to open the
  // application full screen from the home-screen icon.
  appleWebApp: {
    capable: true,
    title: 'ssh-web',
    statusBarStyle: 'black-translucent',
  },
  other: {
    // Next emits the standardised "mobile-web-app-capable", which iOS only
    // understands from 16.4 onwards. The legacy one covers earlier iPhones.
    'apple-mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  themeColor: '#04060a',
  width: 'device-width',
  initialScale: 1,
  // The terminal fills the screen: no accidental zoom while typing, and the
  // safe area of notched phones is respected.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">
        {children}
        <InstallSupport />
      </body>
    </html>
  )
}
