import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { AnalyticsClient } from "@/components/analytics-client";
import { Banners } from "@/components/banners";
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
    // suppressHydrationWarning is required because the inline theme-init
    // script below adds/removes `class="dark"` on <html> before React
    // hydrates. Without this, Next.js detects the className mismatch and
    // reverts the client tree to match the server (which doesn't know the
    // user's persisted theme), stripping the `.dark` class and breaking
    // every `dark:` variant. This is the canonical Next.js recipe for a
    // theme script in the document head.
    <html
      lang="en"
      className={plusJakartaSans.variable}
      suppressHydrationWarning
    >
      <head>
        {/* Apply the persisted theme before first paint to avoid a
         * light-flash on dark-preferring loads. Mirrors canonical: read
         * `localStorage.theme`, fall back to `prefers-color-scheme`, set
         * `documentElement.classList`. The navbar toggle handler keeps
         * `localStorage.theme` in sync on click. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.theme;if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
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
      <body>
        <AnalyticsClient />
        <Suspense fallback={null}>
          <PostHogProvider>
            <FrameworkProvider knownFrameworks={knownFrameworks}>
              {/* RootProvider supplies Fumadocs's theme provider (next-themes)
               * and the search-dialog context, which DocsLayout and other
               * fumadocs-ui components read from. We keep BrandNav + Banners
               * outside DocsLayout so chrome remains shell-docs's own. */}
              <RootProvider theme={{ enabled: true, defaultTheme: "system" }}>
                {/* Body is a fixed-height (100vh) flex column with hidden
                 * overflow (see globals.css). Banner + nav sit naturally
                 * at the top; <main> takes the remaining height and is
                 * the horizontal flex row that hosts sidebar + the
                 * scrolling `.docs-content-wrapper`. No sticky positioning
                 * is needed — chrome stays put because it's outside the
                 * scroll container. Mirrors canonical `#nd-home-layout`
                 * (margin: 0 4px; xl: 0 8px 8px 8px). */}
                <Banners />
                <BrandNav />
                <main className="flex flex-1 min-h-0 overflow-hidden mx-1 xl:mx-2 xl:mb-2">
                  {children}
                </main>
              </RootProvider>
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
