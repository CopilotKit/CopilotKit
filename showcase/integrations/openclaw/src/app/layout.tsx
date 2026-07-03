import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";
import "./copilotkit-overrides.css";

export const metadata: Metadata = {
  title: "OpenClaw — CopilotKit Showcase",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProd = process.env.NODE_ENV === "production";
  return (
    <html lang="en">
      <body>
        {isProd && (
          <script
            dangerouslySetInnerHTML={{
              __html: [
                "console.log('[showcase] OpenClaw demo loaded:', window.location.href);",
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
        )}
        {children}
      </body>
    </html>
  );
}
