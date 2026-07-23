import "./globals.css";
import type { Metadata } from "next";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const metadata: Metadata = {
  title: "CopilotKit Interactive Dojo",
  description: "Interactive showcase of CopilotKit integrations",
};

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
 * Canonical OWASP-recommended escape for inline JSON in HTML.
 */
function serializeRuntimeConfig(cfg: unknown): string {
  return JSON.stringify(cfg)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side: read live env at request time. `unstable_noStore()`
  // inside getRuntimeConfig opts this segment out of the static cache
  // so the inline <script> below always reflects the current Railway
  // env vars. The serialized config carries backendHostPattern, which
  // the client reader uses to derive each integration's preview backend
  // URL at request time (see lib/runtime-config.ts).
  const runtimeConfig = getRuntimeConfig();
  const injection = `window.__SHOWCASE_CONFIG__=${serializeRuntimeConfig(runtimeConfig)};`;

  return (
    <html lang="en">
      <head>
        {/* First child of <head> — MUST execute before every other
            head-level script so client code can read
            window.__SHOWCASE_CONFIG__ during module init. Keep this
            ahead of the fonts <link> and any future next/script
            beforeInteractive blocks. */}
        <script
          id="__showcase_config__"
          dangerouslySetInnerHTML={{ __html: injection }}
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
