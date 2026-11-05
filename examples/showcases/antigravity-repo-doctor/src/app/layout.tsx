import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { THEME_SCRIPT } from "@/lib/theme";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const TITLE = "Antigravity Repo Doctor Demo";
const DESCRIPTION =
  "An agent built on Google Antigravity and CopilotKit that debugs failing GitHub CI, asks before risky steps, and shows diffs and test results.";
const OG_IMAGE = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Antigravity and CopilotKit: Repo Doctor, an agent that fixes broken CI and proves the fix",
};

export const metadata: Metadata = {
  // No public URL variable exists yet; social cards resolve /og.png against this.
  metadataBase: new URL(
    process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? "3000"}`,
  ),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    siteName: TITLE,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script sets the dark class before hydration.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* Extensions add attributes to <body> before hydration. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
