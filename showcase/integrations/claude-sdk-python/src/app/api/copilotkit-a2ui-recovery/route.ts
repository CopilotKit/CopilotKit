// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: false` — the backend Claude Agent SDK agent OWNS
// `generate_a2ui` itself (see src/agents/recovery_agent.py), whose body runs
// the forced `render_a2ui` sub-agent + a NATIVE validate->retry recovery loop +
// the recovery-exhausted hard-fail envelope (OSS-158 / OSS-375). The runtime
// must NOT inject a second copy (double-bind); this `false` is load-bearing.
// The middleware still renders the building -> retrying (N/M) -> painted /
// failed lifecycle.
//
// Unlike the langgraph-python reference (which delegates the loop to
// `ag_ui_langgraph.get_a2ui_tools` / `ag_ui_a2ui_toolkit`), claude-sdk-python
// uses its own adapter (`ag-ui-claude-sdk` + `claude-agent-sdk`) and does NOT
// depend on that toolkit — so the recovery loop is re-implemented natively in
// the Claude backend. The demo reuses the declarative-gen-ui catalog. The
// aimock fixtures force the inner render_a2ui sub-agent to emit a malformed
// first attempt the loop heals (heal pill) or a structurally-invalid surface on
// every attempt (exhaust pill).
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-recovery/route.ts
// - src/agents/recovery_agent.py (the Claude Agent SDK backend)

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const recoveryAgent = createClaudeHttpAgent(`${AGENT_URL}/a2ui-recovery`);

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-recovery": recoveryAgent },
  a2ui: {
    // The backend agent owns `generate_a2ui` explicitly (see
    // src/agents/recovery_agent.py), so the runtime MUST NOT auto-inject its
    // own A2UI tool on top. The A2UI middleware still serialises the client
    // catalog into the agent's `copilotkit.context` and detects the
    // `a2ui_operations` / `a2ui_recovery_exhausted` envelope in the tool result.
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
    return internalRuntimeErrorResponse("/api/copilotkit-a2ui-recovery", error);
  }
};
