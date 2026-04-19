import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { BrandNav } from "@/components/brand-nav";
import { FrameworkProvider } from "@/components/framework-provider";
import { getIntegrations } from "@/lib/registry";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-prose",
  display: "swap",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CopilotKit Docs",
  description: "Docs, live demos, and integrations for CopilotKit",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // FrameworkProvider needs the set of known framework slugs so it can
  // detect URL-scoped framework views. The framework *selector* now
  // lives inside the docs sidebar, not in the top bar, so its own
  // options are wired up in the docs page-level server components.
  const knownFrameworks = getIntegrations().map((i) => i.slug);

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
    >
      <body className="min-h-screen">
        <FrameworkProvider knownFrameworks={knownFrameworks}>
          <BrandNav />
          <main>{children}</main>
        </FrameworkProvider>
        <div
          style={{
            position: "fixed",
            bottom: "8px",
            right: "12px",
            fontSize: "10px",
            fontFamily: "monospace",
            color: "rgba(0,0,0,0.15)",
            pointerEvents: "none",
            zIndex: 9999,
            userSelect: "none",
          }}
        >
          {(process.env.NEXT_PUBLIC_COMMIT_SHA || "dev").slice(0, 9)}
        </div>
      </body>
    </html>
  );
}
