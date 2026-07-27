// Dedicated runtime for the Declarative Generative UI (A2UI) cell.
// The backend owns the `generate_a2ui` tool and performs a secondary Claude
// call against `render_a2ui`, so the runtime must not inject a competing
// A2UI tool. It still reads the page-registered catalog and forwards
// `a2ui_operations` tool results to the renderer.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// @region[a2ui-runtime-setup]
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-gen-ui": createClaudeHttpAgent(
      `${AGENT_URL}/declarative-gen-ui`,
    ),
  },
  a2ui: {
    injectA2UITool: false,
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
