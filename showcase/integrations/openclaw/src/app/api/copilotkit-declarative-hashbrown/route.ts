/**
 * Dedicated runtime for the Declarative Hashbrown demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). The demo relies on a
 * system prompt instructing the model to emit the hashbrown-shaped
 * `{ ui: [...] }` JSON envelope that `@hashbrownai/react`'s `useJsonParser`
 * consumes progressively in `hashbrown-renderer.tsx`. Reliable output depends
 * on that prompt reaching the model via clawg-ui (gateway prompt injection).
 */

import { NextRequest, NextResponse } from "next/server";
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
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
