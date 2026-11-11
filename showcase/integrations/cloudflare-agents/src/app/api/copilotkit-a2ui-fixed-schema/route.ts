// Dedicated runtime for the Declarative Generative UI (A2UI fixed-schema) demo.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { cloudflareAgent, withForwardedHeaders } from "@/lib/cloudflare-agents";

function createAgent() {
  return cloudflareAgent("a2ui-fixed-schema");
}

const a2uiFixedAgent = createAgent();
const agents = {
  "a2ui-fixed-schema": a2uiFixedAgent,
  default: a2uiFixedAgent,
};

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const copilotHandler = createCopilotRuntimeHandler({
        runtime: new CopilotRuntime({
          // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
          agents,
          // Enable the A2UIMiddleware so it detects the `a2ui_operations`
          // envelope the dedicated `a2ui_fixed_schema` backend agent's
          // `display_flight` tool returns and converts it into A2UI activity
          // events the page's catalog renders. `injectA2UITool: false` because
          // the agent emits the envelope itself (no generate_a2ui injection).
          // Mirrors the beautiful-chat route. Pin the catalog the page registers
          // so the middleware doesn't fall back to the unregistered basic catalog.
          a2ui: {
            injectA2UITool: false,
            defaultCatalogId: "copilotkit://flight-fixed-catalog",
          },
        }),
        basePath: "/api/copilotkit-a2ui-fixed-schema",
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
