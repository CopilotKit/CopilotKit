"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { CopilotKitProvider, useCopilotKit } from "@copilotkit/react-core/v2";
import { DEMO_CATALOGS } from "./demo-catalogs";
import { getAgentId } from "./settings";
import type { ExampleSettings } from "./settings";
import { DemoTiming } from "./timing";

/** Stop the old run when changing settings or leaving the demo. */
function StopRunOnUnmount({ agentId }: { agentId: string }) {
  const { copilotkit } = useCopilotKit();
  useEffect(
    () => () => {
      const agent = copilotkit.getAgent(agentId);
      if (agent) copilotkit.stopAgent({ agent });
    },
    [copilotkit, agentId],
  );
  return null;
}

export function Providers({
  children,
  settings,
}: {
  children: ReactNode;
  settings: ExampleSettings;
}) {
  const agentId = getAgentId(settings);
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      agentId={agentId}
      generativeUI={{
        ui: DEMO_CATALOGS[settings.demo],
        transport: settings.transport,
      }}
    >
      <StopRunOnUnmount agentId={agentId} />
      <DemoTiming agentId={agentId} />
      {children}
    </CopilotKitProvider>
  );
}
