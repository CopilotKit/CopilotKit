"use client";

import type { ReactNode } from "react";
import { CopilotKitProvider } from "@copilotkit/react-core/v2";
import { standardUI } from "@copilotkit/react-core/v2/generative-ui";

export type ExampleAgent = "default" | "langgraph";
export type ExampleTransport = "markdown" | "tool";

export function Providers({
  children,
  agent,
  transport,
}: {
  children: ReactNode;
  agent: ExampleAgent;
  transport: ExampleTransport;
}) {
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    //
    // Both transports use the standard components. "markdown": the agent
    // writes the operations inside ```a2ui fences in its reply. "tool": the
    // runtime gives the agent the render_ui tool and streams the surfaces
    // as activity messages.
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      agentId={agent}
      generativeUI={{ ui: standardUI, transport }}
    >
      {children}
    </CopilotKitProvider>
  );
}
