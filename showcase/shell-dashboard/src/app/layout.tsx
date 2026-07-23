import "./globals.css";
import type { Metadata } from "next";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { serializeRuntimeConfig } from "@/lib/runtime-config-serialize";

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

// serializeRuntimeConfig is extracted to `lib/runtime-config-serialize.ts`
// so it can be unit-tested for the OWASP escape behavior (XSS via
// `</script>`, U+2028/U+2029 line-terminator injection) without
// importing the layout into the test runner.

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side: read live env at request time. `unstable_noStore()`
  // inside getRuntimeConfig opts this segment out of the static
  // cache so the inline <script> below always reflects the current
  // Railway env vars.
  //
  // NOTE: `runtimeConfig.opsBaseUrl` is the CLIENT direct override
  // (`NEXT_PUBLIC_OPS_DIRECT_BASE_URL`, default ""), NOT the server proxy
  // target `OPS_BASE_URL`. The harness URL must never be serialized into
  // `window.__SHOWCASE_CONFIG__` — doing so makes the browser fetch the
  // harness cross-origin (CORS-blocked). With opsBaseUrl empty the client
  // uses the same-origin `/api/ops` proxy, which reads `OPS_BASE_URL`
  // server-side in the Route Handler.
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
