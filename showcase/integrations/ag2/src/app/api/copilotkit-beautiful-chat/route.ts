// Dedicated runtime for the (simplified) Beautiful Chat showcase cell.
//
// Beautiful Chat combines TWO of the canonical reference's three flagship
// features in a single cell:
//   - A2UI Dynamic Schema (branded React catalog, agent-owned `generate_a2ui`)
//   - Open Generative UI (auto-injected `generateSandboxedUi` frontend tool)
//
// Splitting into its own endpoint matters because:
//   - `openGenerativeUI` flips a global probe flag that, on the shared
//     `/api/copilotkit` route, would wipe per-cell `useFrontendTool` /
//     `useComponent` registrations (see comment in `copilotkit-ogui/route.ts`).
//   - `a2ui.injectA2UITool: false` is required so the runtime doesn't
//     double-bind a second A2UI tool over the agent-owned `generate_a2ui`.
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - src/app/api/copilotkit-declarative-gen-ui/route.ts (a2ui scoping pattern)
// - src/app/api/copilotkit-ogui/route.ts (openGenerativeUI scoping pattern)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const beautifulChatAgent = new HttpAgent({
  url: `${AGENT_URL}/beautiful-chat/`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "beautiful-chat": beautifulChatAgent },
  // The agent owns `generate_a2ui` explicitly (see
  // src/agents/beautiful_chat.py). The runtime middleware still serialises
  // the registered client catalog into agent context and detects
  // `a2ui_operations` containers in the tool result; it just must NOT bind
  // a second A2UI tool on top.
  a2ui: {
    injectA2UITool: false,
  },
  // Turn on Open Generative UI for this agent. The runtime middleware
  // injects `generateSandboxedUi` as a frontend tool the LLM can call,
  // and converts streaming tool-call deltas into `open-generative-ui`
  // activity events the built-in renderer mounts in a sandboxed iframe.
  openGenerativeUI: {
    agents: ["beautiful-chat"],
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-beautiful-chat",
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
