import type { Metadata } from "next";
import "./globals.css";
import "./copilotkit-overrides.css";
import { themeScript } from "../../_shared/ts/theme";

export const metadata: Metadata = {
  title: "CopilotKit Showcase — Mastra",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
