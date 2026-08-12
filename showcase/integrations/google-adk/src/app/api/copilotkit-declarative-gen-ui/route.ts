// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// demo. No runtime `a2ui` config: the page passes a catalog to the provider
// (`<CopilotKit a2ui={{ catalog }}>`), which auto-enables A2UI and defaults tool
// injection on (CopilotKit >= 1.61.2, PR #5611), matching the langgraph-python
// and AWS Strands gold-standard declarative-gen-ui routes.
// The backend agent (src/agents/declarative_gen_ui_agent.py) wires NO
// `generate_a2ui` tool; the ag-ui-adk >= 0.7.0 adapter sees the injected flag
// and auto-injects `generate_a2ui` (via `plan_a2ui_injection`), then drives the
// forced `render_a2ui` sub-agent + toolkit validate->retry recovery and emits
// the `a2ui_operations` container the A2UI middleware paints. (The ADK-only
// a2ui-recovery demo keeps the backend-owned `get_a2ui_tool` wiring instead,
// since only that path surfaces the recovery loop explicitly.)
//
// The A2UI middleware still serialises the registered client catalog into the
// agent's context (routed into the sub-agent prompt) so the planner knows
// which components to emit, and detects the `a2ui_operations` container in the
// tool result for client-side rendering.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    // Per-request build conveys inbound `x-aimock-context` to the Python
    // agent_server. See `src/lib/header-forwarding.ts`.
    const headers = extractForwardedHeaders(req);
    const declarativeGenUiAgent = new HttpAgent({
      url: `${AGENT_URL}/declarative_gen_ui`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: { "declarative-gen-ui": declarativeGenUiAgent },
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
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
