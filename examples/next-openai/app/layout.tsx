import './globals.css'
import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: 'Copilot/Next/OpenAI example app',
  description: 'Copilot/Next/OpenAI example app'
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html className="h-full" lang="en">
      <body className={`h-full ${inter.className}`}>{children}</body>
    </html>
  )
}
