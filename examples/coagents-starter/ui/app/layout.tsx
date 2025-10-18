import type { Metadata } from "next";

import { CopilotKitWithThreads } from "@/components/CopilotKitWithThreads";

import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoAgents Starter",
  description: "CoAgents Starter",
};

export default function RootLayout({ children }: { children: any }) {
  return (
    <html lang="en">
      <body>
        <CopilotKitWithThreads
          agent="sample_agent"
          runtimeUrl="/api/copilotkit"
          showDevConsole={true}
        >
          {children}
        </CopilotKitWithThreads>
      </body>
    </html>
  );
}
