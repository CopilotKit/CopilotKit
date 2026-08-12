// Dedicated runtime for the declarative-json-render demo (Strands).
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. The backend mounts a dedicated,
// prompt-specialized agent at `/byoc-json-render/` whose system prompt
// (src/agent/agent.ts (buildByocJsonRenderAgent)) instructs the LLM to emit the
// `@json-render/react` flat-spec envelope (`{ root, elements }`); this route
// proxies to that endpoint rather than the generic "/" agent. The demo folder
// + route surface were renamed from `byoc-json-render` to the canonical
// `declarative-json-render`; the agent ID retains its legacy
// `byoc_json_render` name.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-json-render/` });
}

const byocJsonRenderAgent = createAgent();
const agents = {
  byoc_json_render: byocJsonRenderAgent,
  default: byocJsonRenderAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-json-render",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-json-render/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
