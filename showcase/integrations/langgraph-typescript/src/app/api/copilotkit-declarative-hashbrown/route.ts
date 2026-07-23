// Dedicated runtime for the declarative-hashbrown demo.
//
// The demo page (`src/app/demos/declarative-hashbrown/page.tsx`) wraps
// CopilotChat in the HashBrownDashboard provider and overrides the assistant
// message slot with a renderer that consumes hashbrown-shaped structured
// output via `@hashbrownai/react`'s `useUiKit` + `useJsonParser`. The
// agent behind this endpoint uses the `byoc_hashbrown` graph (the internal
// graph ID retains the legacy name; only the user-facing slug, route, and
// frontend folder were renamed).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const byocHashbrownAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "byoc_hashbrown",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-hashbrown-demo": byocHashbrownAgent },
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
