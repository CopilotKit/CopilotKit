// Dedicated runtime for the declarative-json-render demo.
//
// The demo page renders the agent's JSON output into a frontend-owned
// component catalog via @json-render/react. The Worker serves a dedicated,
// prompt-specialized agent at `/agents/byoc-json-render` whose system prompt
// (`ByocJsonRender` in src/agent/agents.ts) instructs the LLM to emit the
// `@json-render/react` flat-spec envelope (`{ root, elements }`); this route
// proxies to that agent rather than the shared one. The demo folder
// + route surface were renamed from `byoc-json-render` to the canonical
// `declarative-json-render`; the agent ID retains its legacy
// `byoc_json_render` name.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";

function createAgent() {
  return cloudflareAgent("byoc-json-render");
}

const byocJsonRenderAgent = createAgent();
const agents = {
  byoc_json_render: byocJsonRenderAgent,
  default: byocJsonRenderAgent,
};

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
          agents,
        }),
        basePath: "/api/copilotkit-declarative-json-render",
        mode: "single-route",
      });
      return await copilotHandler(req);
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
  });
