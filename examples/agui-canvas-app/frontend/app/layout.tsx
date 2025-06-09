import type React from "react"
import "@/app/globals.css"
import { Inter } from "next/font/google"
import { CopilotKit } from "@copilotkit/react-core"
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata = {
  title: "AI Canvas App",
  description: "Canvas-style AI app with agent selection",
  generator: 'v0.dev'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <CopilotKit runtimeUrl="/api/copilotkit">
          {children}
        </CopilotKit>
      </body>
    </html>
  )
}
