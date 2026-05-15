/**
 * Dedicated runtime for the declarative-json-render demo.
 *
 * Splitting into its own endpoint (mirroring beautiful-chat +
 * declarative-gen-ui) keeps the `byoc_json_render` graph isolated from
 * the default multi-agent `/api/copilotkit` runtime. The frontend's
 * demo page (src/app/demos/declarative-json-render/page.tsx) points
 * `<CopilotKit runtimeUrl>` here. The Python module + ADK agent registry
 * key retain the legacy `byoc_json_render` name; only the user-facing
 * slug, route, and frontend folder were renamed.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc_json_render`,
});

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents: { byoc_json_render: byocJsonRenderAgent },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  endpoint: "/api/copilotkit-declarative-json-render",
  serviceAdapter: new ExperimentalEmptyAdapter(),
  runtime,
});

export const POST = async (req: NextRequest) => {
  try {
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
