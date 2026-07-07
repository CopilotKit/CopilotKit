/**
 * Dedicated runtime for the Declarative Hashbrown demo.
 *
 * Proxies to the Claude agent_server's `/byoc-hashbrown` endpoint which
 * instructs Claude to emit the hashbrown-shaped `{ ui: [...] }` JSON
 * envelope that `@hashbrownai/react`'s `useJsonParser` consumes
 * progressively in `hashbrown-renderer.tsx`.
 */

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

const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": createClaudeHttpAgent(
    `${AGENT_URL}/byoc-hashbrown`,
  ),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    return internalRuntimeErrorResponse(
      "/api/copilotkit-declarative-hashbrown",
      error,
    );
  }
};
