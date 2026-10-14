"use client";

import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";

export type ExampleAgent = "default" | "langgraph";

export function Providers({
  children,
  agent,
}: {
  children: ReactNode;
  agent: ExampleAgent;
}) {
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    // a2ui.mode "markdown": the agent writes A2UI operations inside ```a2ui
    // fences in its reply; the standard catalog is used by default.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      agentId={agent}
      a2ui={{ mode: "markdown" }}
    >
      {children}
    </CopilotKit>
  );
}
