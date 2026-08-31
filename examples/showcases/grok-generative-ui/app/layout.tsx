import type { Metadata } from "next";
import {
  CopilotChatConfigurationProvider,
  CopilotKit,
} from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grok 4.6 × CopilotKit — Generative UI",
  description:
    "grok-4.6 searches X server-side, then renders the answer as live UI via CopilotKit frontend tools.",
};

/**
 * Ambient layer: the Verified CopilotKit cover gradient at low opacity plus a
 * low-contrast dot field. Both sit behind content and never carry legibility.
 */
function Ambient() {
  return (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, zIndex: 0, overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          top: "-38%",
          left: "-12%",
          width: "124%",
          height: "78%",
          background:
            "linear-gradient(90deg, #BEC2FF 0%, #85ECCE 45.673%, #FFAC4D 100%)",
          opacity: 0.14,
          filter: "blur(160px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-30%",
          right: "-10%",
          width: "60%",
          height: "58%",
          borderRadius: "50%",
          background: "#BEC2FF",
          opacity: 0.06,
          filter: "blur(150px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 60% at 50% 0%, #000 30%, transparent 78%)",
        }}
      />
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // `dark` switches CopilotKit v2's own stylesheet to its dark palette.
    <html lang="en" className="dark">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {/* Keep the Inspector out of recordings. */}
        <CopilotKit runtimeUrl="/api/copilotkit" enableInspector={false}>
          {/* The composer is the page's own input, so it gets the page's voice. */}
          <CopilotChatConfigurationProvider
            labels={{ chatInputPlaceholder: "Ask what X thinks about…" }}
          >
            <div
              style={{
                position: "relative",
                overflow: "hidden",
                minHeight: "100vh",
              }}
            >
              <Ambient />
              {children}
            </div>
          </CopilotChatConfigurationProvider>
        </CopilotKit>
      </body>
    </html>
  );
}
