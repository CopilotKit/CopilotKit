"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { ThemeProvider } from "@/hooks/use-theme";
// A2UI catalog: definitions + renderers in ./declarative-generative-ui/
import { demonstrationCatalog } from "./declarative-generative-ui/renderers";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <title>CopilotKit</title>
        <link
          rel="icon"
          type="image/svg+xml"
          href="/copilotkit-logo-mark.svg"
        />
      </head>
      <body className={`antialiased`}>
        <ThemeProvider>
          <CopilotKitProvider
            runtimeUrl="/api/copilotkit"
            useSingleEndpoint
            inspectorDefaultAnchor={{ horizontal: "left", vertical: "top" }}
            a2ui={{ catalog: demonstrationCatalog }}
          >
            {children}
          </CopilotKitProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
