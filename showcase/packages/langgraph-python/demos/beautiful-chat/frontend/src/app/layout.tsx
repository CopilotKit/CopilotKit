"use client";

// Beautiful Chat — mirrors the canonical polished starter at
// /examples/integrations/langgraph-python. The CopilotKit provider lives in
// the layout so brand fonts + theme tokens are applied app-wide.

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { ThemeProvider } from "@/hooks/use-theme";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>Beautiful Chat</title>
        <link
          rel="icon"
          type="image/svg+xml"
          href="/copilotkit-logo-mark.svg"
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <CopilotKit runtimeUrl="/api/copilotkit" agent="beautiful-chat">
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
