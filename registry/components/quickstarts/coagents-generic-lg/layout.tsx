import type { Metadata } from "next";

import { CopilotKit } from "@copilotkit/react-core";

import "@copilotkit/react-ui/styles.css";

export const metadata: Metadata = {
  title: "CoAgents Starter",
  description: "CoAgents Starter",
};

export default function RootLayout({ children }: { children: any }) {
  return (
    <CopilotKit
      agent={process.env.NEXT_PUBLIC_AGENT_NAME}
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
    >
      {children}
    </CopilotKit>
  );
}
