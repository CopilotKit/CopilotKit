// Dedicated runtime for the Multimodal Attachments demo.
//
// Scoped to its own endpoint so the attachment pipeline (base64 image /
// PDF forwarding, vision content blocks) is contained to this one cell.
// Other demos' runtimes stay lean and their chat LLMs unaffected.
//
// Backend: a dedicated CrewAI Flow at `/multimodal`. The CrewAI bridge
// normalizes AG-UI attachment parts into LiteLLM/OpenAI content blocks before
// the Flow starts, and the Flow sends them to a vision-capable model.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/multimodal` });
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
