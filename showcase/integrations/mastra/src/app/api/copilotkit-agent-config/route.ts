// Dedicated runtime for the Agent Config Object demo (Mastra).
//
// The frontend publishes its tone / expertise / responseLength toggles to the
// agent via `useAgentContext` (see src/app/demos/agent-config/config-context-relay.tsx),
// which the runtime serializes onto the AG-UI run as a context entry. This is a
// plain runtime — no A2UI / MCP / open-gen-ui flags — so it could in principle
// share /api/copilotkit, but it keeps its own route to match the north-star
// langgraph-python layout (route-per-demo) and to register the exact agent id
// the page requests without touching the shared registry.
//
// NOTE (OSS-451): this route was missing entirely — the page pointed at
// /api/copilotkit-agent-config, which 404'd, so the demo never mounted. The
// page requests agent id "agent-config-demo", which is registered below.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const agentConfigAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-agent-config",
});

if (!agentConfigAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/agent-config",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    // The page's <CopilotKit agent="agent-config-demo"> and the demo-layout
    // CopilotChat agentId="agent-config-demo" both resolve here.
    "agent-config-demo": agentConfigAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: agentConfigAgent,
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-agent-config",
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
  });
