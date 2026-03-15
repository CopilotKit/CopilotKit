"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";
import "@/a2ui/theme.css";

import { CopilotKit } from "@copilotkit/react-core";
import { ThemeProvider } from "@/hooks/use-theme";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`antialiased`}>
        <ThemeProvider>
          <CopilotKit
            runtimeUrl="/api/copilotkit"
            inspectorDefaultAnchor={{ horizontal: "left", vertical: "top" }}
            // A2UI theming: use a2ui={{ theme }} for JS overrides, or
            // import a CSS file targeting .a2ui-surface variables (see @/a2ui/theme.css)
            a2ui={{}}
          >
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
