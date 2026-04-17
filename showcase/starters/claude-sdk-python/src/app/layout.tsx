import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import "./copilotkit-overrides.css";

export const metadata: Metadata = {
  title: "CopilotKit Showcase — Claude SDK Python",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              console.log('[showcase] Claude SDK Python demo loaded');
              console.log('[showcase] URL:', window.location.href);
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
        {children}
      </body>
    </html>
  );
}
