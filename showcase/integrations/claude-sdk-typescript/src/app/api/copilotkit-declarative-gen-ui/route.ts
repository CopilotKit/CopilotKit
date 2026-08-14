// Dedicated runtime for the Declarative Generative UI (A2UI) cell.
// LGP shape: injectA2UITool true so middleware owns `render_a2ui`.
// The backend still binds no-arg `generate_a2ui` as a fallback if the
// call reaches the agent body.

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
    injectA2UITool: true,
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
