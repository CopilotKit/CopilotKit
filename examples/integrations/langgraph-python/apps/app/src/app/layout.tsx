"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core";
import { ThemeProvider } from "@/hooks/use-theme";
import { appCatalog } from "@/a2ui/catalog";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>
        <ThemeProvider>
          <CopilotKit
            runtimeUrl="/api/copilotkit"
            enableInspector={false}
            inspectorDefaultAnchor={{ horizontal: "left", vertical: "top" }}
            a2ui={{ catalogs: [appCatalog] }}
          >
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
