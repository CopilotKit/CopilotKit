// Dedicated runtime for the Multimodal Attachments demo.
//
// Scoped to its own endpoint so the attachment pipeline (base64 image /
// PDF forwarding, vision content blocks) is contained to this one cell.
// Other demos' runtimes stay lean and their chat LLMs unaffected.
//
// Backend: reuses the shared CrewAI crew via HttpAgent. The crew's chat
// LLM is `gpt-4o` (see `crew.py`) which accepts image content blocks
// natively — attachments forwarded through the AG-UI pipeline reach the
// chat-LLM layer and are visible to the model. A dedicated per-demo crew
// with vision-tuned agent prompts is tracked as follow-up work.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  // The page's <CopilotKit agent="multimodal-demo"> resolves here.
  "multimodal-demo": createAgent(),
  // Alias for any internal component that calls `useAgent()` without args.
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts; published CopilotRuntime's `agents`
        // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
        // plain Records. Fixed in source, pending release.
        agents,
      }),
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
