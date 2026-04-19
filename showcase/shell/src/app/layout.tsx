import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { BrandNav } from "@/components/brand-nav";
import { FrameworkProvider } from "@/components/framework-provider";
import { getIntegrations, getCategoryLabel } from "@/lib/registry";
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
  // Build framework options once per request from the registry so the
  // selector (mounted inside BrandNav) and the FrameworkProvider stay in
  // sync. Integration ordering follows `sort_order`.
  const integrations = getIntegrations();
  const frameworkOptions = integrations
    .slice()
    .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999))
    .map((i) => ({
      slug: i.slug,
      name: i.name,
      category: i.category ?? "other",
      logo: i.logo ?? null,
      deployed: i.deployed,
    }));
  const knownFrameworks = frameworkOptions.map((o) => o.slug);
  // Category order for the selector — match the integrations page's
  // typical grouping so the UX is consistent across surfaces.
  const integrationCategoryIds = [
    "popular",
    "agent-framework",
    "provider-sdk",
    "enterprise-platform",
    "protocol",
    "emerging",
    "starter",
  ];
  const frameworkCategoryOrder = integrationCategoryIds.map((id) => ({
    id,
    name: getCategoryLabel(id),
  }));

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
    >
      <body className="min-h-screen">
        <FrameworkProvider knownFrameworks={knownFrameworks}>
          <BrandNav
            frameworkOptions={frameworkOptions}
            frameworkCategoryOrder={frameworkCategoryOrder}
          />
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
