// Dedicated runtime for the A2UI — Fixed Schema cell. Splitting into its
// own endpoint lets us set `a2ui.injectA2UITool: false` — the backend
// Claude SDK agent owns the `display_flight` tool which emits its own
// `a2ui_operations` container directly in the tool result.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema/route.ts
// - src/agent/a2ui-fixed-prompt.ts (the Claude SDK backend)

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const a2uiFixedSchemaAgent = createClaudeHttpAgent(
  `${AGENT_URL}/a2ui-fixed-schema`,
);

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: {
    // The backend agent emits its own `a2ui_operations` container inside
    // `display_flight` (see src/agent/a2ui-fixed-prompt.ts). We still run
    // the A2UI middleware so it detects the container in tool results
    // and forwards surfaces to the frontend — but we do NOT inject a
    // runtime `render_a2ui` tool on top of the agent's existing tools.
    injectA2UITool: false,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse(
      "/api/copilotkit-a2ui-fixed-schema",
      error,
    );
  }
};
