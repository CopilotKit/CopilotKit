// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Splitting into its own endpoint lets us set
// `a2ui.injectA2UITool: false` — the backend Claude Agent SDK agent owns the
// `generate_a2ui` tool itself, so double-binding from the runtime would
// duplicate the tool slot and confuse the LLM.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-gen-ui/route.ts
// - src/agents/a2ui_dynamic.py (the Claude Agent SDK backend)

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = createClaudeHttpAgent(
  `${AGENT_URL}/declarative-gen-ui`,
);

// @region[a2ui-runtime-setup]
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: {
    // The backend agent owns `generate_a2ui` explicitly (see
    // src/agents/a2ui_dynamic.py), so the runtime MUST NOT auto-inject its
    // own A2UI tool on top. The A2UI middleware still runs — it serialises
    // the registered client catalog into the agent's `copilotkit.context`
    // so the secondary LLM inside `generate_a2ui` knows which components to
    // emit — and it still detects the `a2ui_operations` container in the
    // tool result and streams rendered surfaces to the frontend.
    injectA2UITool: false,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});
// @endregion[a2ui-runtime-setup]

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse(
      "/api/copilotkit-declarative-gen-ui",
      error,
    );
  }
};
