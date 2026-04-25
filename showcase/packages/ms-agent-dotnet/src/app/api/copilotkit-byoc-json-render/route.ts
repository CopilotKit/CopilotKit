/**
 * Dedicated runtime for the BYOC json-render demo.
 *
 * Splits into its own endpoint so the `byoc_json_render` agent is isolated
 * from the default `/api/copilotkit` multi-agent runtime. The frontend
 * (src/app/demos/byoc-json-render/page.tsx) points `<CopilotKit runtimeUrl>`
 * here, and the .NET backend exposes the agent at `/byoc-json-render`
 * (wired in Program.cs).
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
  byoc_json_render: new HttpAgent({
    url: `${AGENT_URL}/byoc-json-render`,
  }),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-json-render",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- same generics mismatch as other dedicated routes.
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
