/**
 * Dedicated runtime for the Declarative Hashbrown demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). The demo relies on a
 * system prompt instructing the model to emit the hashbrown-shaped
 * `{ ui: [...] }` JSON envelope that `@hashbrownai/react`'s `useJsonParser`
 * consumes progressively in `hashbrown-renderer.tsx`. Reliable output depends
 * on that prompt reaching the model via ag-ui (gateway prompt injection).
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": createGatewayAgent(),
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
    // Log the full error server-side under an opaque id; return only the id.
    // Returning error.message/stack leaks server internals (paths, versions,
    // env-derived values) to any caller. Matches copilotkit-subagents/route.ts.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-declarative-hashbrown",
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
