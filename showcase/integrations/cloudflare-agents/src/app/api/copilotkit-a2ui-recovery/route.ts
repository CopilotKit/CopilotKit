// Dedicated runtime for the A2UI Error Recovery demo.
// Scoped so a2ui options for this cell stay isolated from the shared route.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";

function createAgent() {
  return cloudflareAgent("a2ui-recovery");
}

const a2uiAgent = createAgent();
const agents = {
  "a2ui-recovery": a2uiAgent,
  default: a2uiAgent,
};

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
          agents,
          // No runtime `a2ui` config: the page passes a catalog to the provider
          // (`<CopilotKit a2ui={{ catalog }}>`), which auto-enables A2UI and
          // defaults tool injection on (CopilotKit >= 1.61.2, PR #5611). The
          // `A2uiRecovery` agent drops the injected `render_a2ui` client tool
          // and answers through its own `generate_a2ui`, which runs the
          // recovery loop (src/agent/a2ui.ts); the A2UIMiddleware renders the
          // result.
        }),
        basePath: "/api/copilotkit-a2ui-recovery",
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
  });
