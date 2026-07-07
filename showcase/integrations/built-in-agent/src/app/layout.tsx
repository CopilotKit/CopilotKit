import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import "./copilotkit-overrides.css";

export const metadata: Metadata = {
  title: "Built-in Agent (TanStack AI) — CopilotKit Showcase",
};

const themeInitScript = `(function(){try{var p=new URLSearchParams(window.location.search);var t=p.get('theme')||p.get('colorScheme');if(t!=='dark'&&t!=='light'){t=localStorage.theme;}if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          id="showcase-theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: [
              "console.log('[showcase] Demo loaded:', window.location.href);",
              "console.log('[showcase] In iframe:', window.self !== window.top);",
              "window.addEventListener('error', function(e) {",
              "  console.error('[showcase] Uncaught error:', e.message, e.filename, e.lineno);",
              "});",
              "window.addEventListener('unhandledrejection', function(e) {",
              "  console.error('[showcase] Unhandled rejection:', e.reason);",
              "});",
            ].join("\n"),
          }}
        />
        {children}
      </body>
    </html>
  );
}
