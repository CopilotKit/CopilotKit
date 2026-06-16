import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Built-in Agent (TanStack AI) — CopilotKit Showcase",
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
            __html: [
              "(function() {",
              "  var target = window.crypto;",
              "  if (!target || typeof target.randomUUID === 'function') return;",
              "  var getRandomValues = typeof target.getRandomValues === 'function'",
              "    ? target.getRandomValues.bind(target)",
              "    : null;",
              "  var fallback = function() {",
              "    var bytes = new Uint8Array(16);",
              "    if (getRandomValues) {",
              "      getRandomValues(bytes);",
              "    } else {",
              "      for (var i = 0; i < bytes.length; i += 1) {",
              "        bytes[i] = Math.floor(Math.random() * 256);",
              "      }",
              "    }",
              "    bytes[6] = (bytes[6] & 15) | 64;",
              "    bytes[8] = (bytes[8] & 63) | 128;",
              "    var hex = Array.prototype.map.call(bytes, function(byte) {",
              "      return byte.toString(16).padStart(2, '0');",
              "    });",
              "    return hex.slice(0, 4).join('') + '-' +",
              "      hex.slice(4, 6).join('') + '-' +",
              "      hex.slice(6, 8).join('') + '-' +",
              "      hex.slice(8, 10).join('') + '-' +",
              "      hex.slice(10, 16).join('');",
              "  };",
              "  try {",
              "    Object.defineProperty(target, 'randomUUID', {",
              "      configurable: true,",
              "      value: fallback,",
              "    });",
              "  } catch (error) {",
              "    target.randomUUID = fallback;",
              "  }",
              "}());",
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
