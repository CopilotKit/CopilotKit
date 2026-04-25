/**
 * Dedicated runtime for the byoc-hashbrown demo.
 *
 * The demo page (`src/app/demos/byoc-hashbrown/page.tsx`) wraps CopilotChat
 * in the HashBrownDashboard provider and overrides the assistant message
 * slot with a renderer that consumes hashbrown-shaped structured output via
 * `@hashbrownai/react`'s `useUiKit` + `useJsonParser`. The .NET agent
 * behind this endpoint (`ByocHashbrownAgentFactory`, mounted at
 * `/byoc-hashbrown` on the AG-UI server) has a system prompt tuned to emit
 * that shape.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown`,
  }),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- same-shape mismatch as the default route.ts in this
        // package; HttpAgent satisfies the runtime's agent interface at
        // runtime but the generics don't line up across the v1/v2 boundary.
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
