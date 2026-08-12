// Dedicated runtime for the Multimodal Attachments demo.
//
// Scoped to its own endpoint + its own Python backend route
// (`/multimodal`) so the vision-capable Claude model and PDF-flatten
// middleware stay out of the other demos' code paths. The page at
// src/app/demos/multimodal/page.tsx mounts
// <CopilotKit agent="multimodal-demo"> against this URL.
//
// Note: unlike the langgraph-python reference, this runtime does NOT
// need an `onRunInitialized` legacy-binary shim. Claude's Messages API
// accepts the modern AG-UI `{type: "image" | "document", source: {...}}`
// shape natively once the backend converts it (see
// src/agents/multimodal_agent.py :: `convert_part_for_claude`). The
// legacy rewrite that langgraph-python needs is entirely a
// @ag-ui/langgraph converter concern and is not required here.

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return createClaudeHttpAgent(`${AGENT_URL}/multimodal`);
}

const agents: Record<string, AbstractAgent> = {
  "multimodal-demo": createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse("/api/copilotkit-multimodal", error);
  }
};
