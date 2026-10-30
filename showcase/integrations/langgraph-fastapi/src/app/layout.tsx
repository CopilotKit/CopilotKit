import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import { themeScript } from "./theme-script";

export const metadata: Metadata = {
  title: "CopilotKit Showcase — LangGraph (FastAPI)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProd = process.env.NODE_ENV === "production";
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {isProd && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                console.log('[showcase] LangGraph FastAPI demo loaded');
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
