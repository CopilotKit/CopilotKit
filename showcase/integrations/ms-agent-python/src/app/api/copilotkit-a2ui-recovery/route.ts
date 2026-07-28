// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: false` — the backend MS Agent Framework agent OWNS
// `generate_a2ui` (see src/agents/recovery_agent.py), so the runtime must NOT
// inject a second copy (double-bind). This `false` is load-bearing post
// CopilotKit#5611 (the provider catalog otherwise defaults injectA2UITool to
// true). The middleware still renders A2UI surfaces from tool results.
//
// The demo reuses the declarative-gen-ui catalog. MAF has no toolkit
// validate→retry loop (unlike LangGraph get_a2ui_tools); aimock fixtures
// drive the secondary `_design_a2ui_surface` planner for the heal/exhaust pills.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-recovery/route.ts
// - src/agents/recovery_agent.py (backend agent, mounted at `/a2ui_recovery`)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

// The MS Agent backend runs as a separate process on port 8000. This runtime
// proxies CopilotKit requests to it via AG-UI protocol. The A2UI recovery
// agent is mounted at `/a2ui_recovery` by `agent_server.py`.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const recoveryAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui_recovery`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "a2ui-recovery": recoveryAgent },
  a2ui: {
    // The backend agent owns the `generate_a2ui` tool explicitly (see
    // src/agents/recovery_agent.py), so the runtime MUST NOT auto-inject its
    // own A2UI tool on top.
    injectA2UITool: false,
    // Reuse the catalog the page registers (shared with declarative-gen-ui).
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-recovery",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
