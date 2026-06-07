// Dedicated runtime for the declarative-hashbrown demo (Strands).
//
// The shared Strands backend (agent_server.py) hosts a single Strands Agent
// instance. For the declarative-hashbrown demo we need the LLM to emit a
// strict hashbrown JSON envelope (see src/agents/byoc_hashbrown.py for the
// canonical prompt). This route currently proxies to the shared backend
// agent at "/"; backend prompt specialization for this demo is tracked
// separately and not wired through this route yet.
//
// The demo folder + route + agent slug were renamed from `byoc-hashbrown` to
// the canonical `declarative-hashbrown` surface; the page mounts
// <CopilotKit agent="declarative-hashbrown-demo">.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const declarativeHashbrownAgent = createAgent();
const agents = {
  "declarative-hashbrown-demo": declarativeHashbrownAgent,
  default: declarativeHashbrownAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });
    return await handleRequest(req);
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
