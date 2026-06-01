import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Spline_Sans_Mono } from "next/font/google";
import { BrandNav } from "@/components/brand-nav";
import { FrameworkProvider } from "@/components/framework-provider";
import { getIntegrations } from "@/lib/registry";
import { getRuntimeConfig } from "@/lib/runtime-config";
import "./globals.css";

/**
 * Serialize the runtime config for inline injection. We must
 * JSON.stringify-then-escape because the value lands inside a
 * `<script>...</script>` tag, where three substrings would otherwise
 * break out of (or corrupt) the parser:
 *
 *   - `<` — guards against the `</script>` breakout (XSS).
 *     `JSON.stringify` does NOT escape `<` by default, so a URL
 *     containing `</script>` (e.g. a hostile env value) would
 *     terminate the inline script and inject HTML. Escape every
 *     `<` to `<` so the substring `</script>` can never appear.
 *   - `
` (LINE SEPARATOR) and `
` (PARAGRAPH SEPARATOR) —
 *     legal inside JSON strings, but a syntax error inside a JS
 *     string literal in older engines / when the page is parsed as
 *     `text/javascript`. Escape both.
 *
 * IMPORTANT: the regex sources below use explicit `
` / `
`
 * ECMAScript-Unicode escapes — the regex engine resolves the escape at
 * compile time, so `/
/` matches the actual U+2028 codepoint.
 * Using a literal U+2028 / U+2029 character in the regex source would
 * break the parser (those codepoints terminate a regex literal in
 * pre-ES2019 engines, and are visually invisible — easy to ship
 * accidentally). Reviewers MUST confirm these regexes are written with
 * `
` / `
` escapes literally.
 *
 * Canonical OWASP-recommended escape for inline JSON in HTML.
 */
function serializeRuntimeConfig(cfg: unknown): string {
  return JSON.stringify(cfg)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

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
  title: "CopilotKit Showcase",
  description:
    "Live integration gallery for CopilotKit — 17 AI frameworks, real-time health probes, and interactive demos",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "CopilotKit Showcase",
    description:
      "Live integration gallery for CopilotKit — 17 AI frameworks, real-time health probes, and interactive demos",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
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

  // Server-side: read live env at request time. `unstable_noStore()`
  // inside getRuntimeConfig opts this segment out of the static cache
  // so the inline <script> below always reflects the current Railway
  // env vars rather than baked-in build-time values.
  const runtimeConfig = getRuntimeConfig();
  const injection = `window.__SHOWCASE_CONFIG__=${serializeRuntimeConfig(runtimeConfig)};`;

  return (
    <html
      lang="en"
      className={`${plusJakartaSans.variable} ${splineSansMono.variable}`}
    >
      <head>
        {/* Must be the first (and currently only) child of <head>:
         * every client component reads window.__SHOWCASE_CONFIG__
         * during hydration; it must be populated by the time the
         * parser reaches <body>. */}
        <script
          id="__showcase_config__"
          dangerouslySetInnerHTML={{ __html: injection }}
        />
      </head>
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
