import React, { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <CopilotKit agent={process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME}>
      {children}
    </CopilotKit>
  );
}
