import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
// The CopilotKit faces, self-hosted from npm (no font fetch at build time).
import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/spline-sans-mono";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { SIDEBAR_BOOT } from "./sidebar-state";

/** The public origin, for absolute Open Graph URLs. */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3011";

const title = "Standard components · CopilotKit";
const description =
  "A live model renders CopilotKit's 69 standard generative UI components in the chat: forms, tables, charts, maps and more, as they ship in @copilotkit/react-core.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: "%s · Standard components · CopilotKit" },
  description,
  applicationName: "CopilotKit standard components",
  openGraph: {
    type: "website",
    siteName: "CopilotKit",
    title,
    description,
    url: "/",
  },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#dedee9",
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Restores a collapsed sidebar before paint (see shell.tsx). */}
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
