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
      "box-shadow": "0 2px 8px rgba(0,0,0,0.08)",
    },
    Button: {
      ...a2uiDefaultTheme.additionalStyles?.Button,
      "font-weight": "600",
      "letter-spacing": "0.02em",
    },
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
