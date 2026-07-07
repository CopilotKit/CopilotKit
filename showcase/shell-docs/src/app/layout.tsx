import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import Script from "next/script";
import { RootProvider } from "fumadocs-ui/provider/next";
import { AnalyticsClient } from "@/components/analytics-client";
import { Banners } from "@/components/banners";
import { BrandNav } from "@/components/brand-nav";
import { FrameworkProvider } from "@/components/framework-provider";
import { ShellSearchProvider } from "@/components/search-trigger";
import { PostHogProvider } from "@/lib/providers/posthog-provider";
import { ScarfPixel } from "@/lib/providers/scarf-pixel";
import { getIntegrations } from "@/lib/registry";
import { RESERVED_ROUTE_SLUGS } from "@/lib/reserved-route-slugs";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { serializeRuntimeConfig } from "@/lib/runtime-config-serialize";
import "./globals.css";

// serializeRuntimeConfig is extracted to `lib/runtime-config-serialize.ts`
// so it can be unit-tested for the OWASP escape behavior (XSS via
// `</script>`, U+2028/U+2029 line-terminator injection) without
// importing the layout into the test runner.

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-prose",
  display: "swap",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-code",
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

  // Server-side: read live env at request time. `unstable_noStore()`
  // inside getRuntimeConfig opts this segment out of the static
  // cache so the inline <script> below always reflects the current
  // Railway env vars.
  const runtimeConfig = getRuntimeConfig();
  const injection = `window.__SHOWCASE_CONFIG__=${serializeRuntimeConfig(runtimeConfig)};`;
  const REO_KEY = runtimeConfig.reoKey;
  const REB2B_KEY = runtimeConfig.reb2bKey;

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
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* MUST be the first child of <head>. Every client component
         * reads window.__SHOWCASE_CONFIG__ during hydration; populating
         * it from a raw inline <script> guarantees the value is set
         * before the parser reaches any next-script beforeInteractive
         * block (those run after the parser passes our inline script).
         * Using a plain <script> rather than next/script also avoids
         * the deferred-execution semantics of `strategy="beforeInteractive"`
         * — `beforeInteractive` runs before hydration but AFTER raw
         * parse-time scripts. */}
        <script
          id="__showcase_config__"
          dangerouslySetInnerHTML={{ __html: injection }}
        />
        {/* Apply the persisted theme before first paint to avoid a
         * light-flash on dark-preferring loads. Reads `localStorage.theme`
         * and falls back to `prefers-color-scheme` when the persisted
         * value is missing OR explicitly `"system"` (next-themes persists
         * the literal string `"system"` when the user picks that mode via
         * its API — without the `=== "system"` check here, a system-
         * preferring user who explicitly chose system mode would get the
         * very light-flash this script exists to prevent). */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.theme;if(!t||t==='system'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
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
        {/* No <Suspense> wrapper around the page tree. Previously this
         * was wrapped in a Suspense with a null fallback, which caused
         * Next.js to start streaming the response BEFORE the page
         * component called `notFound()`. Once bytes are in the wire,
         * Next can't change the response status, so every unknown URL
         * returned HTTP 200 + the not-found UI (a soft-404 that demoted
         * the entire site in search rankings). The PostHogProvider and
         * FrameworkProvider are client components and don't suspend
         * during server render, so removing the boundary is safe.
         */}
        <PostHogProvider>
          <FrameworkProvider knownFrameworks={knownFrameworks}>
            {/* RootProvider supplies Fumadocs's theme provider (next-themes).
             * Search is handled exclusively by shell-docs's SearchTrigger. */}
            <RootProvider
              theme={{ enabled: true, defaultTheme: "system" }}
              search={{ enabled: false }}
            >
              <ShellSearchProvider>
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
                <main className="flex flex-1 min-h-0 overflow-hidden mx-1 md:mx-[22px] mt-2 md:mt-3 mb-2 md:mb-3">
                  {children}
                </main>
              </ShellSearchProvider>
            </RootProvider>
          </FrameworkProvider>
        </PostHogProvider>
        <div aria-hidden="true" className="shell-docs-commit-label">
          {commitLabel}
        </div>
        <ScarfPixel />
      </body>
    </html>
  );
}
