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

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
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
    // Native auto-injection (matches the langgraph-python reference). The
    // backend agent (src/agents/a2ui_dynamic.py) owns NO A2UI tool; the
    // runtime forwards `injectA2UITool: true` and the Microsoft Agent
    // Framework adapter's `plan_a2ui_injection` auto-injects the native
    // `generate_a2ui` sub-agent (progressive `render_a2ui` streaming + the
    // shared toolkit recovery loop). The A2UI middleware still serialises the
    // registered client catalog into the agent's context so the sub-agent
    // knows which components to emit.
    injectA2UITool: true,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-gen-ui",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
