// Docs-only snippet — not imported or executed. The mastra runtime route
// (src/app/api/copilotkit/route.ts) uses the unified Mastra adapter and
// bundles `generateA2uiTool` into the weatherAgent, so it doesn't follow
// the runtime-injection pattern this region teaches. This file shows what
// the equivalent CopilotRuntime configuration looks like for a TS framework
// that DOES want CopilotKit to auto-inject the render_a2ui tool — the case
// the dynamic-schema docs page is documenting. See
// chat-component.snippet.tsx in agentic-chat for the same pattern.

import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

declare const myCatalog: unknown;
declare const myAgent: unknown;

// @region[runtime-inject-tool]
const runtime = new CopilotRuntime({
  // @ts-ignore -- agent type is framework-specific
  agents: { "declarative-gen-ui": myAgent },
  a2ui: {
    // injectA2UITool: true tells the runtime to add the `render_a2ui` tool
    // to the agent's tool list at request time and serialise the client
    // catalog into the agent's `copilotkit.context`. Use this when your
    // backend agent does NOT already register its own a2ui-emitting tool.
    injectA2UITool: true,
    catalog: myCatalog,
  },
});

export const POST = async (req: NextRequest) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    endpoint: "/api/copilotkit-declarative-gen-ui",
    serviceAdapter: new ExperimentalEmptyAdapter(),
    runtime,
  });
  try {
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string };
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
};
// @endregion[runtime-inject-tool]
