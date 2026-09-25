/**
 * Dedicated runtime for the Declarative JSON Render demo.
 *
 * Proxies to the Claude agent_server's `/byoc-json-render` endpoint, which
 * swaps in a system prompt instructing Claude to emit a `@json-render/react`
 * flat-spec JSON object. Isolated from the shared `/api/copilotkit` runtime
 * so the declarative-render system prompt cannot leak into other demos.
 */

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  byoc_json_render: createClaudeHttpAgent(`${AGENT_URL}/byoc-json-render`),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-json-render",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse(
      "/api/copilotkit-declarative-json-render",
      error,
    );
  }
};
