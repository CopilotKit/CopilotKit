/**
 * Dedicated runtime for the Multimodal Attachments demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). Full image/PDF support
 * depends on the gateway forwarding multimodal message parts to a
 * vision-capable model — a clawg-ui capability, not per-demo backend logic.
 * The dedicated endpoint keeps this demo's runtime isolated from the shared one.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const multimodalAgent = createGatewayAgent();

const agents: Record<string, AbstractAgent> = {
  "multimodal-demo": multimodalAgent,
  default: multimodalAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
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
