// Dedicated runtime for the Declarative Generative UI (A2UI fixed-schema) demo.

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
  // Dedicated backend agent mounted at /a2ui-fixed-schema (see
  // src/agent/server.ts). It owns the `display_flight` tool which emits its
  // own a2ui_operations envelope; the runtime A2UIMiddleware paints it. No
  // `a2ui: { injectA2UITool }` flag is needed — the envelope mechanism does
  // not require runtime tool injection.
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-fixed-schema/` });
}

const a2uiFixedAgent = createAgent();
const agents = {
  "a2ui-fixed-schema": a2uiFixedAgent,
  default: a2uiFixedAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
      serviceAdapter: new ExperimentalEmptyAdapter(),
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
