import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { SharedProvider } from "@/lib/shared-context"
import { CopilotKit } from "@copilotkit/react-core"
import { SharedTestsProvider } from "@/lib/shared-tests-context"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Enterprise SaaS Dashboard",
  description: "Enterprise SaaS Dashboard with persistent chat",
  generator: 'v0.dev'
}

export default function RootLayout({
  children,
  chat,
}: {
  children: React.ReactNode
  chat: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <CopilotKit runtimeUrl="/api/copilotkit">
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
            <SharedProvider>
              <SharedTestsProvider>
                <SidebarProvider>
                  <div className="flex h-screen w-full overflow-hidden bg-background">
                    {children}
                    {chat}
                  </div>
                </SidebarProvider>
              </SharedTestsProvider>
            </SharedProvider>
          </ThemeProvider>
        </CopilotKit>
      </body>
    </html >
  )
}
