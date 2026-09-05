import type { Metadata } from "next";

import { CopilotKit } from "@copilotkit/react-core/v2";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

export const metadata: Metadata = {
  title: "OpenAI Agents + CopilotKit Starter",
  description:
    "A minimal starter connecting an OpenAI Agents SDK agent to CopilotKit over AG-UI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>
        <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
          {children}
        </CopilotKit>
      </body>
    </html>
  );
}
