// Dedicated runtime for the BYOC Hashbrown demo.
//
// The shared Strands backend (agent_server.py) hosts a single Strands Agent
// instance. For the byoc-hashbrown demo we need the LLM to emit a strict
// hashbrown JSON envelope (see src/agents/byoc_hashbrown.py for the canonical
// prompt). Since the shared backend's system prompt is configured at agent
// construction time, prompt specialization per demo is accomplished via the
// `forwardedProps.additional_instructions` field that the Strands agent reads
// from the run config.
//
// If/when the Strands backend is extended to host multiple Agent instances on
// sub-paths (e.g. /byoc_hashbrown/), this route will swap to an HttpAgent
// pointing at that sub-path.

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

const byocHashbrownAgent = createAgent();
const agents = {
  "byoc-hashbrown-demo": byocHashbrownAgent,
  default: byocHashbrownAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
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
