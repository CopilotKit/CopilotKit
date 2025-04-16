import "@copilotkit/react-ui/styles.css";
import React, { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core";

// Where CopilotKit will proxy requests to. If you're using Copilot Cloud, this environment variable will be empty.
const runtimeUrl = process.env.NEXT_PUBLIC_COPILOTKIT_RUNTIME_URL
// When using Copilot Cloud, all we need is the publicApiKey.
const publicApiKey = process.env.NEXT_PUBLIC_COPILOT_API_KEY;
// The name of the agent that we'll be using.
const agentName = process.env.NEXT_PUBLIC_COPILOTKIT_AGENT_NAME

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <CopilotKit 
      runtimeUrl={runtimeUrl}
      publicApiKey={publicApiKey}
      agent={agentName}
    >
      {children}
    </CopilotKit>
  );
}
