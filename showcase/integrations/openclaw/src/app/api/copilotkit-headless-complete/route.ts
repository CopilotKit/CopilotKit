// Dedicated runtime for the Headless Chat (Complete) cell. Proxies to the
// OpenClaw gateway (pass-through). In the claude-sdk reference the
// `get_weather` / `get_stock_price` tools were backend-owned; against the
// thin gateway they must be frontend-forwarded (useFrontendTool) like the
// demo's `highlight_note` tool, so they reach the model as client tools and
// are intercepted by the AG-UI client when the model calls them.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const headlessCompleteAgent = createGatewayAgent();

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "headless-complete": headlessCompleteAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-headless-complete",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    // Log the full error server-side under an opaque id; return only the id.
    // Returning error.message/stack leaks server internals (paths, versions,
    // env-derived values) to any caller. Matches copilotkit-subagents/route.ts.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-headless-complete",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
