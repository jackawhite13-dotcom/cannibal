import type { Metadata } from 'next'
import Providers from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'Cannibal — Keyword Cannibalization Audit',
  description: 'Keyword cannibalization audit tool by daydream',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
