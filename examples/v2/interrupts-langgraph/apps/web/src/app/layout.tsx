import type { Metadata } from "next";

import { CopilotKitProvider } from "@copilotkit/react-core";
import "./globals.css";

export const metadata: Metadata = {
  title: "CopilotKit LangGraph Interrupts Starter",
  description:
    "A starter template for building AI agents with human-in-the-loop interrupts using LangGraph and CopilotKit.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={"antialiased"}>
        <CopilotKitProvider
          runtimeUrl="/api/copilotkit"
          agentId="default"
          useSingleEndpoint
        >
          {children}
        </CopilotKitProvider>
      </body>
    </html>
  );
}
