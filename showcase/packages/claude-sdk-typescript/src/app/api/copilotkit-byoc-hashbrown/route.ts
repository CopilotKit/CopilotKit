/**
 * Dedicated runtime for the BYOC hashbrown demo.
 *
 * Proxies to the Claude agent_server's `/byoc-hashbrown` endpoint which
 * instructs Claude to emit the hashbrown-shaped `{ ui: [...] }` JSON
 * envelope that `@hashbrownai/react`'s `useJsonParser` consumes
 * progressively in `hashbrown-renderer.tsx`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown`,
  }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
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
};
