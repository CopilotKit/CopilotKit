// Dedicated runtime for the Multimodal Attachments demo.
//
// Scoped to its own route mostly so the Playwright spec can assert against
// exactly one URL. The runtime proxies to the same Spring-AI ChatClient
// backend (the existing bean already uses a vision-capable OpenAI model
// such as gpt-4.1). Whether the `ag-ui:spring-ai` adapter currently forwards
// multipart attachments from CopilotChat into Spring AI's
// `UserMessage.media` list is integration-dependent — see PARITY_NOTES.md
// for the current state.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const multimodalAgent = createAgent();
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
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-multimodal",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
