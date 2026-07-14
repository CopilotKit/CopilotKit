"use client";

import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

import { CopilotKit } from "@copilotkit/react-core/v2";
import { ThemeProvider } from "@/hooks/use-theme";

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>CopilotKit</title>
        <link
          rel="icon"
          type="image/svg+xml"
          href="/copilotkit-logo-mark.svg"
        />
        {/*
          Set the theme class BEFORE first paint to avoid a white→dark flash.
          ThemeProvider applies the theme in a useEffect (post-hydration), so
          without this the page paints unthemed (light) first, then flips. This
          blocking inline script matches ThemeProvider's "system" default so
          there's no flash and no class mismatch when the provider re-applies.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var d=window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.add(d?'dark':'light');}catch(e){}})();",
          }}
        />
      </head>
      {/*
        suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
        attributes like data-gr-ext-installed onto <body> before React hydrates,
        which would otherwise surface as a hydration mismatch on first load.
        This only relaxes the check for <body>'s own attributes (one level deep);
        everything rendered inside <body> is still fully hydration-checked.
      */}
      <body className={`antialiased`} suppressHydrationWarning>
        <ThemeProvider>
          <CopilotKit
            runtimeUrl="/api/copilotkit"
            // Forward the user's gateway settings (both stored in localStorage,
            // both optional) to the runtime. This function is evaluated when the
            // provider renders (NOT on every request), which is why the token
            // gate reloads after saving so new settings take effect. The runtime
            // uses these to build the OpenClaw agent: the token becomes
            // `Authorization: Bearer <token>`; the URL header tells the runtime
            // which gateway to talk to.
            headers={(): Record<string, string> => {
              if (typeof window === "undefined") return {};
              const h: Record<string, string> = {};
              // localStorage can throw (private mode / sandboxed iframe) —
              // degrade to no stored settings rather than breaking every request.
              try {
                const token = window.localStorage.getItem(
                  "openclaw_gateway_token",
                );
                if (token) h.Authorization = `Bearer ${token}`;
                const url = window.localStorage.getItem("openclaw_gateway_url");
                if (url) h["x-openclaw-operator-url"] = url;
              } catch {
                /* storage unavailable — send no gateway headers */
              }
              return h;
            }}
            inspectorDefaultAnchor={{ horizontal: "right", vertical: "top" }}
            openGenerativeUI={{}}
            useSingleEndpoint={false}
          >
            {children}
          </CopilotKit>
        </ThemeProvider>
      </body>
    </html>
  );
}
