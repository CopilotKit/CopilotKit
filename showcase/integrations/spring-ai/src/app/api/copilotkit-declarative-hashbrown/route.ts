// Dedicated runtime for the declarative-hashbrown demo (Spring AI).
//
// The demo page wraps CopilotChat in HashBrownDashboard and overrides the
// assistant message slot with a renderer that consumes hashbrown-shaped
// structured output via `@hashbrownai/react`'s `useUiKit` + `useJsonParser`.
// The Spring AI backend runs a dedicated controller at /byoc-hashbrown/run
// (ByocHashbrownController) whose system prompt instructs the LLM to emit the
// hashbrown UI-kit envelope (`{ "ui": [ { "<component>": { "props": {...} } } ] }`);
// this route proxies to it rather than the generic "/" agent. The page
// mounts <CopilotKit agent="declarative-hashbrown-demo">.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-hashbrown/run` });
}

const declarativeHashbrownAgent = createAgent();
const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": declarativeHashbrownAgent,
  default: declarativeHashbrownAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
      basePath: "/api/copilotkit-declarative-hashbrown",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-hashbrown/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
