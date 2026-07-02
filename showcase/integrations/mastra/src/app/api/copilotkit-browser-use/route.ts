// Dedicated Copilot Runtime for the Browser Use demo (Mastra, OSS-91).
//
// The demo drives a real LOCAL headless browser (Playwright Chromium — no
// hosted-browser API key) via the Mastra `browserUseAgent`'s `browse_web`
// tool. It lives on its own runtime endpoint so it can bind a dedicated
// agent + resourceId without threading through the shared `/api/copilotkit`
// registry. Mirrors the beautiful-chat route.

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

const browserUseAgent = getLocalAgent({
  mastra,
  agentId: "browserUseAgent",
  resourceId: "mastra-browser-use",
});

if (!browserUseAgent) {
  throw new Error(
    "getLocalAgent returned null for browserUseAgent — required for /demos/browser-use",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "browser-use": browserUseAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: browserUseAgent,
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-browser-use",
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
