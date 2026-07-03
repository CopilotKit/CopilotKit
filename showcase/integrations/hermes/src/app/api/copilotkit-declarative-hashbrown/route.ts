// Dedicated runtime for the declarative-hashbrown demo.
//
// The demo page (`src/app/demos/declarative-hashbrown/page.tsx`) wraps the
// `<Chat />` component in the HashBrownDashboard provider; `Chat` overrides
// the CopilotChat assistantMessage slot with a renderer that consumes
// hashbrown-shaped structured output via `@hashbrownai/react`. Hermes serves
// every run from a single AG-UI endpoint, so this proxies to the same
// HttpAgent as the main route; only the runtime endpoint + registered agent
// name (`declarative-hashbrown-demo`) differ.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-hashbrown-demo": new HermesAgent({ url: `${AGENT_URL}/` }),
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
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
