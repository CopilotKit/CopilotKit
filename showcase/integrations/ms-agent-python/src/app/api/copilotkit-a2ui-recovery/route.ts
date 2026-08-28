// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: true` — native auto-injection, same as declarative-gen-ui.
// The agent binds no A2UI tool; the adapter auto-injects `generate_a2ui` and runs
// the `render_a2ui` sub-agent + the shared toolkit validate->retry recovery loop.
// The recovery cap + catalog come from the `/a2ui_recovery` endpoint's `a2ui_config`
// (see src/agents/recovery_agent.py + agent_server.py), which is where MAF's upstream
// recovery example and the other MAF demos put backend A2UI policy. The middleware
// renders the building -> retrying (N/M) -> painted / failed lifecycle.
//
// The demo reuses the declarative-gen-ui catalog. The aimock fixtures force the
// inner render_a2ui sub-agent to emit a structurally-invalid first attempt the
// loop heals (heal pill) or an invalid surface on every attempt (exhaust pill).

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
    injectA2UITool: true,
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
