/**
 * Dedicated runtime for the Sub-Agents demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). The demo's supervisor →
 * sub-agent orchestration (research / writing / critique) and its live
 * delegation log — driven by `state.delegations` `STATE_SNAPSHOT` events —
 * depend on multi-agent orchestration + shared-state support in ag-ui,
 * which the thin gateway does not yet provide. Bucket-B gap; see the roadmap.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const subagentsAgent = createGatewayAgent();

const agents: Record<string, AbstractAgent> = {
  subagents: subagentsAgent,
  default: subagentsAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts for type-hole notes
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-subagents",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    // Log full stack server-side, return only an opaque error id to the
    // client. Returning `error.message` / `error.stack` over the wire leaks
    // server internals (file paths, env-derived values, third-party stack
    // frames) to anyone who can hit this endpoint. Reference shape:
    // `mastra/src/app/api/copilotkit/route.ts` `logRouteError`.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-subagents",
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
