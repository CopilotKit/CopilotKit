// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: false` — the backend MS-Agent-Framework agent OWNS
// `generate_a2ui` via the adapter's native `enable_a2ui` (see
// src/agents/recovery_agent.py), whose body runs the `render_a2ui` sub-agent +
// the shared toolkit validate->retry recovery loop + the recovery-exhausted
// hard-fail envelope in-process (OSS-158 / OSS-375). The runtime must NOT inject
// a second copy (double-bind); this `false` is load-bearing (the provider
// catalog otherwise defaults injectA2UITool to true). The middleware still
// serialises the registered catalog into the agent's context and renders the
// building -> retrying (N/M) -> painted / failed lifecycle.
//
// The demo reuses the declarative-gen-ui catalog. The aimock fixtures force the
// inner render_a2ui sub-agent to emit a structurally-invalid first attempt the
// loop heals (heal pill) or an invalid surface on every attempt (exhaust pill).
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
// proxies CopilotKit requests to it via AG-UI protocol. The A2UI error-recovery
// agent is mounted at `/a2ui_recovery` by `agent_server.py`.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const recoveryAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui_recovery`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "a2ui-recovery": recoveryAgent },
  a2ui: {
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
