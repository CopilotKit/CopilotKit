// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: false` — the backend LangGraph (TS) agent OWNS
// `generate_a2ui` via `@ag-ui/langgraph` `getA2UITools` (see
// src/agent/recovery-agent.ts), whose body runs the `render_a2ui` sub-agent +
// the toolkit validate->retry recovery loop + the recovery-exhausted hard-fail
// envelope IN-GRAPH (OSS-158 / OSS-375). The runtime must NOT inject a second
// copy (double-bind); this `false` is load-bearing post CopilotKit#5611 (the
// provider catalog otherwise defaults injectA2UITool to true). The middleware
// still renders the building -> retrying (N/M) -> painted / failed lifecycle.
//
// The demo reuses the declarative-gen-ui catalog. The aimock fixtures force the
// inner render_a2ui sub-agent to emit free-form/sloppy args the middleware heals
// (heal pill) or a structurally-invalid surface on every attempt (exhaust pill).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const recoveryAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "a2ui_recovery",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
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
