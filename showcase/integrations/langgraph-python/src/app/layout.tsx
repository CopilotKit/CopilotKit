import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CopilotKit Showcase — LangGraph (Python)",
};

const themeInitScript = `(function(){try{var p=new URLSearchParams(window.location.search);var t=p.get('theme')||p.get('colorScheme');if(t!=='dark'&&t!=='light'){t=localStorage.theme;}if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.classList.toggle('dark',t==='dark');document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProd = process.env.NODE_ENV === "production";
  return (
    <html lang="en">
      <head>
        <script
          id="showcase-theme-init"
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body>
        {isProd && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                console.log('[showcase] LangGraph Python demo loaded');
                console.log('[showcase] URL:', window.location.href);
                console.log('[showcase] Referrer:', document.referrer);
                console.log('[showcase] In iframe:', window.self !== window.top);
                window.addEventListener('error', function(e) {
                    console.error('[showcase] Uncaught error:', e.message, e.filename, e.lineno);
                });
                window.addEventListener('unhandledrejection', function(e) {
                    console.error('[showcase] Unhandled rejection:', e.reason);
                });
              `,
            }}
          />
        )}
        {children}
      </body>
    </html>
  );
}
