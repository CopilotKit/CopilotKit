// Dedicated runtime for the Multimodal Attachments demo.
//
// Mirrors showcase/integrations/langgraph-python/src/app/api/copilotkit-multimodal/route.ts
// but proxies to the PydanticAI backend's `/multimodal/` mount
// (see src/agent_server.py). A dedicated route keeps the vision-capable
// model (gpt-4o) scoped to this one demo so other cells keep their
// cheaper, text-only models.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "multimodal-demo": new HttpAgent({ url: `${AGENT_URL}/multimodal/` }),
  default: new HttpAgent({ url: `${AGENT_URL}/multimodal/` }),
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
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
