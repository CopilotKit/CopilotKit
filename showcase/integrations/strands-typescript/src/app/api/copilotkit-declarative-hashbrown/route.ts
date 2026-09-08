// Dedicated runtime for the declarative-hashbrown demo (Strands).
//
// The declarative-hashbrown demo needs the LLM to emit a strict hashbrown
// JSON envelope (see src/agent/agent.ts (buildByocHashbrownAgent) for the canonical prompt).
// The shared Strands agent at "/" cannot produce that envelope, so the
// backend mounts a dedicated, prompt-specialized agent at `/byoc-hashbrown/`
// (see src/agent/server.ts) and this route proxies to it.
//
// The demo folder + route + agent slug were renamed from `byoc-hashbrown` to
// the canonical `declarative-hashbrown` surface; the page mounts
// <CopilotKit agent="declarative-hashbrown-demo">.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-hashbrown/` });
}

const declarativeHashbrownAgent = createAgent();
const agents = {
  "declarative-hashbrown-demo": declarativeHashbrownAgent,
  default: declarativeHashbrownAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
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
