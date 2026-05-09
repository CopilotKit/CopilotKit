import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import { AnalyticsClient } from "@/components/analytics-client";
import { BrandNav } from "@/components/brand-nav";
import { FrameworkProvider } from "@/components/framework-provider";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ScarfPixel } from "@/lib/providers/scarf-pixel";
import { getIntegrations } from "@/lib/registry";
import "./globals.css";

// Top-level route segments in src/app/ that must not be mistaken for
// framework slugs by FrameworkProvider.urlFramework. If an integration
// registry entry ever ships a slug colliding with one of these, the
// framework URL-resolver would otherwise hijack the route.
export const RESERVED_ROUTE_SLUGS = [
  "docs",
  "ag-ui",
  "reference",
  "api",
] as const;

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
  //
  // Guard against registry slugs that would collide with top-level
  // route segments under src/app/ (see RESERVED_ROUTE_SLUGS). Without
  // this filter, a registry entry named e.g. "reference" would cause
  // FrameworkProvider.urlFramework to treat /reference as a framework
  // scope rather than the reference docs route.
  const reserved = new Set<string>(RESERVED_ROUTE_SLUGS);
  const knownFrameworks = getIntegrations()
    .map((i) => i.slug)
    .filter((slug) => {
      if (reserved.has(slug)) {
        // Always log — a registry integration slug colliding with a
        // reserved top-level route is a hard wiring bug that production
        // operators need to see in logs, not a dev-only warning.
        // eslint-disable-next-line no-console
        console.error(
          `[layout] integration slug "${slug}" collides with a reserved top-level route and was dropped from knownFrameworks. Rename the integration slug or update RESERVED_ROUTE_SLUGS.`,
        );
        return false;
      }
      return true;
    });

  // Distinguish "unset" from "empty" for the commit-SHA overlay.
  // Docker ARG scope bugs can surface as an empty string rather than
  // undefined; showing "dev" in that case is misleading. See the
  // Dockerfile fix for the root cause.
  const rawSha = process.env.NEXT_PUBLIC_COMMIT_SHA;
  const commitLabel =
    rawSha === undefined
      ? "dev"
      : rawSha === ""
        ? "unknown"
        : rawSha.slice(0, 7);

  const REO_KEY = process.env.NEXT_PUBLIC_REO_KEY;
  const REB2B_KEY = process.env.NEXT_PUBLIC_REB2B_KEY;

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
    >
      <head>
        {REO_KEY ? (
          <Script
            id="reo-init-script"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                  !function(){
                    var e, t, n;
                    e = ${JSON.stringify(REO_KEY)};
                    t = function() {
                      if (window.Reo) {
                        window.Reo.init({ clientID: e });
                      }
                    };
                    n = document.createElement("script");
                    n.src = "https://static.reo.dev/" + e + "/reo.js";
                    n.defer = true;
                    n.onload = t;
                    document.head.appendChild(n);
                  }();
                `,
            }}
          />
        ) : null}
        <Script
          id="hubspot-script"
          type="text/javascript"
          src="https://js.hs-scripts.com/45532593.js"
          async
          defer
        />
        {REB2B_KEY ? (
          <Script
            id="reb2b-script"
            strategy="afterInteractive"
            src={`https://b2bjsstore.s3.us-west-2.amazonaws.com/b/${REB2B_KEY}/${REB2B_KEY}.js.gz`}
          />
        ) : null}
      </head>
      <body className="min-h-screen">
        <AnalyticsClient />
        <Suspense fallback={null}>
          <PostHogProvider>
            <FrameworkProvider knownFrameworks={knownFrameworks}>
              <BrandNav />
              <main>{children}</main>
            </FrameworkProvider>
          </PostHogProvider>
        </Suspense>
        <div
          aria-hidden="true"
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
          {commitLabel}
        </div>
        <ScarfPixel />
      </body>
    </html>
  );
}
