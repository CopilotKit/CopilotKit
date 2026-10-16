"use client";

import type { ReactNode } from "react";
import { CopilotKit } from "@copilotkit/react-core/v2";
import { standardCatalog } from "@copilotkit/a2ui-renderer";

export type ExampleAgent = "default" | "langgraph";
export type ExampleMode = "markdown" | "tool";

export function Providers({
  children,
  agent,
  mode,
}: {
  children: ReactNode;
  agent: ExampleAgent;
  mode: ExampleMode;
}) {
  return (
    // useSingleEndpoint={false} selects the REST transport served by the
    // multi-route runtime in app/api/copilotkit/[[...slug]]/route.ts.
    //
    // Both modes use the same catalog. "markdown": the agent writes A2UI
    // operations inside ```a2ui fences in its reply (standardCatalog is the
    // default). "tool": the provider forwards the catalog, the runtime injects
    // the render_a2ui tool and streams surfaces as activity messages.
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
      agent={agent}
      a2ui={
        mode === "tool" ? { catalog: standardCatalog } : { mode: "markdown" }
      }
    >
      {children}
    </CopilotKit>
  );
}
