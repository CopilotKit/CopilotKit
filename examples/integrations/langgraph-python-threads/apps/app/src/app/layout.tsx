"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ThemeProvider } from "@/hooks/use-theme";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>
        <ThemeProvider>
          <CopilotKitProvider
            runtimeUrl={
              process.env.NEXT_PUBLIC_BFF_URL ||
              "http://localhost:4000/api/copilotkit"
            }
          >
            {children}
          </CopilotKitProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
