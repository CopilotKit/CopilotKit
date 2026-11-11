// Dedicated runtime for the Agent Config Object demo.
//
// The page uses <CopilotKitProvider properties={...}> to forward a typed
// config object (tone / expertise / responseLength) to the agent. Scoped to
// its own endpoint so the Playwright spec can assert propagation against a
// single URL.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";

function createAgent() {
  return cloudflareAgent("showcase");
}

const agentConfigAgent = createAgent();
const agents = {
  "agent-config-demo": agentConfigAgent,
  default: agentConfigAgent,
};

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
          agents,
        }),
        basePath: "/api/copilotkit-agent-config",
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
