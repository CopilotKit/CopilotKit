// Dedicated runtime for the A2UI Error Recovery cell. Splitting into its own
// endpoint (mirroring the LangGraph reference) lets us set
// `a2ui.injectA2UITool: false` — the backend .NET agent OWNS `generate_a2ui`,
// whose body runs the forced `render_a2ui` sub-agent + the toolkit
// validate->retry recovery loop + the recovery-exhausted hard-fail envelope
// IN-GRAPH (OSS-158 / OSS-375). The runtime must NOT inject a second copy
// (double-bind); this `false` is load-bearing post CopilotKit#5611 (the
// provider catalog otherwise defaults injectA2UITool to true). The middleware
// still renders the building -> retrying (N/M) -> painted / failed lifecycle.
//
// The demo reuses the declarative-gen-ui catalog (same components, same
// catalogId). The .NET backend exposes this agent at `AGENT_URL/a2ui-recovery`
// (see agent/Program.cs).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const recoveryAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui-recovery`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-recovery": recoveryAgent },
  a2ui: {
    // The backend agent owns `generate_a2ui` and runs the recovery loop
    // in-graph. We still run the A2UI middleware so it renders the
    // building -> retrying -> painted / failed lifecycle — but we do NOT
    // inject a runtime `render_a2ui` tool on top of the agent's tools.
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
