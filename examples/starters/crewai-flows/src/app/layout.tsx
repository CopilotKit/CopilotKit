import type { Metadata } from "next";

import { CopilotKitProvider } from "@copilotkit/react-core";
import "./globals.css";

export const metadata: Metadata = {
  title: "CrewAI Flows + CopilotKit Starter",
  description: "A starter demo connecting a CrewAI flow to CopilotKit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/*
        suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
        attributes like data-gr-ext-installed onto <body> before React hydrates,
        which would otherwise surface as a hydration mismatch on first load.
        This only relaxes the check for <body>'s own attributes (one level deep);
        everything rendered inside <body> is still fully hydration-checked.
      */}
      <body className={"antialiased"} suppressHydrationWarning>
        {/* Force REST transport so runtime-info + threads both hit the multi-route endpoint (auto-detect races the lazily-compiled API route in next dev). */}
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          useSingleEndpoint={false}
        >
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}
