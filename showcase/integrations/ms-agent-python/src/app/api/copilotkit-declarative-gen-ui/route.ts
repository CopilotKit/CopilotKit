// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// demo. Splitting into its own endpoint (mirroring the LangGraph reference)
// lets us set `a2ui.injectA2UITool: false` — the backend agent owns the
// `generate_a2ui` tool itself (see `src/agents/a2ui_dynamic.py`), so
// double-binding from the runtime would duplicate the tool slot and confuse
// the LLM.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-gen-ui/route.ts
// - src/agents/a2ui_dynamic.py (backend agent, mounted at `/a2ui_dynamic`)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

// The MS Agent backend runs as a separate process on port 8000. This runtime
// proxies CopilotKit requests to it via AG-UI protocol. The A2UI — dynamic
// agent is mounted at `/a2ui_dynamic` by `agent_server.py`.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui_dynamic`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: {
    // The backend agent owns the `generate_a2ui` tool explicitly (see
    // src/agents/a2ui_dynamic.py), so the runtime MUST NOT auto-inject its
    // own A2UI tool on top. The A2UI middleware still runs — it serialises
    // the registered client catalog into the agent's `copilotkit.context`
    // so the secondary LLM inside `generate_a2ui` knows which components
    // to emit — and it still detects the `a2ui_operations` container in
    // the tool result and streams rendered surfaces to the frontend.
    injectA2UITool: false,
    openGenerativeUI: false,
  },
});

export const POST = async (req: NextRequest) => {
  try {
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
