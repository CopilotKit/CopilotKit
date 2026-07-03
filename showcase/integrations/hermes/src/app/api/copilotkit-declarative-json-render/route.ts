/**
 * Dedicated runtime for the declarative-json-render demo.
 *
 * Splitting into its own endpoint (mirroring the langgraph-python package)
 * keeps the `byoc_json_render` agent isolated from the default multi-agent
 * `/api/copilotkit` runtime. The frontend's demo page
 * (src/app/demos/declarative-json-render/page.tsx) points
 * `<CopilotKit runtimeUrl>` here. Hermes serves every run from a single
 * AG-UI endpoint, so this proxies to the same HttpAgent as the main route;
 * only the runtime endpoint + registered agent name differ.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- same-shape mismatch as the main route in this package; the
  // HttpAgent satisfies the runtime's agent interface at runtime but the
  // generics don't line up across the v1/v2 boundary.
  agents: { byoc_json_render: new HermesAgent({ url: `${AGENT_URL}/` }) },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-json-render",
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
};
