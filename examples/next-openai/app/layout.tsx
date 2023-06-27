import { CopilotProvider } from './CopilotContext'
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
    <html lang="en">
      <body className={inter.className}>
        <CopilotProvider>{children}</CopilotProvider>
      </body>
    </html>
  )
}
