/**
 * Dedicated runtime for the Multimodal Attachments demo.
 *
 * Proxies to the Claude agent_server's `/multimodal` endpoint which is
 * forced to the vision-capable Sonnet model and understands image +
 * document (PDF) parts natively through Anthropic's Messages API — no
 * pypdf flattening is needed on the Claude side.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const multimodalAgent = createClaudeHttpAgent(`${AGENT_URL}/multimodal`);

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
