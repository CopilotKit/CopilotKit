import "./globals.css";
import type { Metadata } from "next";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const metadata: Metadata = {
  title: "CopilotKit Internal Showcase",
  description: "Internal feature × integration matrix",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "CopilotKit Internal Showcase",
    description: "Internal feature × integration matrix",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
};

/**
 * Inline script that runs before React hydrates to prevent flash of wrong
 * theme. Reads localStorage and sets data-theme on <html> synchronously.
 */
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("dashboard:theme");
    if (t === "light" || t === "dark") {
      document.documentElement.setAttribute("data-theme", t);
    } else {
      document.documentElement.setAttribute("data-theme", "system");
    }
  } catch(e) {
    document.documentElement.setAttribute("data-theme", "system");
  }
})();
`;

/**
 * Serialize the runtime config for inline injection. We must
 * JSON.stringify-then-escape because the value lands inside a
 * `<script>...</script>` tag, where four substrings would otherwise
 * break out of (or corrupt) the parser:
 *
 *   - `<` — guards against the `</script>` breakout (XSS).
 *     `JSON.stringify` does NOT escape `<` by default, so a URL
 *     containing `</script>` (e.g. a hostile env value) would
 *     terminate the inline script and inject HTML. Escape every
 *     `<` to `<` so the substring `</script>` can never appear.
 *   - ` ` (LINE SEPARATOR) and ` ` (PARAGRAPH SEPARATOR) —
 *     legal inside JSON strings, but a syntax error inside a JS
 *     string literal in older engines / when the page is parsed as
 *     `text/javascript`. Escape both.
 *
 * IMPORTANT: the regex sources below are written with explicit
 * ` ` / ` ` ECMAScript-Unicode escapes (the regex literal
 * `/ /` matches the actual U+2028 codepoint at runtime — the
 * regex engine resolves the escape, not the source-file encoding).
 * Using a literal ASCII space in the regex source would be a no-op
 * and silently leave the XSS / parser hazards in place. Reviewers MUST
 * confirm the regex sources are ` ` / ` ` literally.
 *
 * Canonical OWASP-recommended escape for inline JSON in HTML.
 */
function serializeRuntimeConfig(cfg: unknown): string {
  // Regex sources reference the literal codepoints via the RegExp
  // constructor with `\u` escapes (resolved at runtime by the regex
  // engine). Using the actual U+2028 / U+2029 characters in a regex
  // literal is a parse error in TypeScript / many JS engines because
  // both codepoints are line terminators that would prematurely
  // terminate the regex literal. Same OWASP-recommended escape as for
  // inline JSON.
  return JSON.stringify(cfg)
    .replace(new RegExp("<", "g"), "\\u003c")
    .replace(new RegExp("\u2028", "g"), "\\u2028")
    .replace(new RegExp("\u2029", "g"), "\\u2029");
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side: read live env at request time. `unstable_noStore()`
  // inside getRuntimeConfig opts this segment out of the static
  // cache so the inline <script> below always reflects the current
  // Railway env vars.
  const runtimeConfig = getRuntimeConfig();
  const injection = `window.__SHOWCASE_CONFIG__=${serializeRuntimeConfig(runtimeConfig)};`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Order matters: __showcase_config__ MUST run before any
         * client component reads window.__SHOWCASE_CONFIG__. We
         * put it FIRST in <head>, before the theme-init script
         * (which has no dependency on it) and well before
         * <body> where client components mount.
         */}
        <script
          id="__showcase_config__"
          dangerouslySetInnerHTML={{ __html: injection }}
        />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        {children}
        <div id="link-preview-root" />
      </body>
    </html>
  );
}
