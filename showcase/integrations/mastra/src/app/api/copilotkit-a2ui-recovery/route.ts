// Dedicated runtime for the A2UI Error Recovery cell (Mastra, OSS-422).
//
// Scoped so the a2ui options for this cell stay isolated from the shared
// `/api/copilotkit` route. The backend `a2uiRecoveryAgent` OWNS `generate_a2ui`
// via getA2UITools (which runs the forced render_a2ui subagent + the toolkit
// validate->retry recovery loop + the recovery-exhausted hard-fail), so the
// runtime must NOT inject a second copy — hence `a2ui.injectA2UITool: false`.
// Mirrors the langgraph-python / strands recovery routes.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const recoveryAgent = getLocalAgent({
  mastra,
  agentId: "a2uiRecoveryAgent",
  resourceId: "mastra-a2uiRecoveryAgent",
});

if (!recoveryAgent) {
  throw new Error(
    "getLocalAgent returned null for a2uiRecoveryAgent — required for /demos/a2ui-recovery",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts (published agents type wraps Record)
  agents: {
    "a2ui-recovery": recoveryAgent,
    default: recoveryAgent,
  },
  a2ui: {
    // a2uiRecoveryAgent already owns `generate_a2ui` (getA2UITools) — don't
    // let the runtime double-inject it.
    injectA2UITool: false,
    // The page registers the declarative-gen-ui catalog; pin it so the render
    // subagent grounds against the same components (and doesn't fall back to
    // the basic spec catalog).
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-a2ui-recovery",
        serviceAdapter: new ExperimentalEmptyAdapter(),
        runtime,
      });
      return await handleRequest(req);
    } catch (error: unknown) {
      const e = error as { message?: string; stack?: string };
      return NextResponse.json(
        { error: e.message, stack: e.stack },
        { status: 500 },
      );
    }
  });
