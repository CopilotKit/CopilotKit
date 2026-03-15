"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core";
import { a2uiDefaultTheme } from "@copilotkit/react-core/v2";
import { ThemeProvider } from "@/hooks/use-theme";

// Customize A2UI component styles by spreading over the default theme
const a2uiTheme = {
  ...a2uiDefaultTheme,
  additionalStyles: {
    ...a2uiDefaultTheme.additionalStyles,
    Card: {
      ...a2uiDefaultTheme.additionalStyles?.Card,
      "border-radius": "12px",
      "box-shadow": "0 1px 4px rgba(0,0,0,0.1)",
      padding: "16px",
    },
    Button: {
      ...a2uiDefaultTheme.additionalStyles?.Button,
      background: "#000",
      color: "#fff",
      "border-radius": "8px",
      "font-weight": "600",
      // Override CSS variables that child Text components read
      "--foreground": "#fff",
    },
    // Note: Don't set Text.color here — it would override button text color
    // via inline styles. Let Text inherit color from parent elements.
  },
};

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
            a2ui={{ theme: a2uiTheme }}
          >
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
