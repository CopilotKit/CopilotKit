import type { Metadata } from "next";

import { CopilotKit } from "@copilotkit/react-core";

import "@copilotkit/react-ui/styles.css";

export const metadata: Metadata = {
  title: "CoAgents Starter",
  description: "CoAgents Starter",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <CopilotKit
      agent={process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME}
      runtimeUrl={process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL}
      publicApiKey={process.env.NEXT_PUBLIC_COPILOT_API_KEY}
    >
      {children}
    </CopilotKit>
  );
}