import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { CopilotKit } from "@copilotkit/react-core"
import { LayoutProvider } from "./contexts/LayoutContext"
import Wrapper from "./wrapper"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Open Gemini Canvas",
  description: "Powered by Google's most advanced AI models for generating LinkedIn and X posts",
  generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <LayoutProvider>
        <Wrapper>
          <body className={inter.className}>
            {children}
          </body>
        </Wrapper>
      </LayoutProvider>
    </html>
  )
}
