import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

// Register the same agent under all names used by demo pages.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  // Prebuilt chat UI demos
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless-complete",
  "beautiful-chat",
  // Frontend tool demos
  "frontend-tools",
  "frontend-tools-async",
  "hitl-in-app",
  "hitl-in-chat",
  // Generative UI demos
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  "open-gen-ui",
  "open-gen-ui-advanced",
  // Tool rendering variants
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  // Readonly state
  "readonly-state-agent-context",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
agents["default"] = createAgent();

// Demo-specific agents with distinct backend prompts live at dedicated
// sub-paths on the PydanticAI server (see src/agent_server.py). Override
// the URL for those agent ids so they proxy to the right backend mount
// instead of the shared sales agent at the root.
agents["headless-complete"] = new HttpAgent({
  url: `${AGENT_URL}/headless_complete/`,
});
agents["shared-state-read-write"] = new HttpAgent({
  url: `${AGENT_URL}/shared_state_read_write/`,
});
agents["subagents"] = new HttpAgent({
  url: `${AGENT_URL}/subagents/`,
});
agents["gen-ui-tool-based"] = new HttpAgent({
  url: `${AGENT_URL}/gen_ui_tool_based/`,
});

// In-Chat HITL — chat-only agent; the `book_call` tool is defined on the
// frontend via `useHumanInTheLoop`. Backed by the dedicated mount at
// `/hitl_in_chat` (see src/agent_server.py).
agents["hitl-in-chat"] = new HttpAgent({
  url: `${AGENT_URL}/hitl_in_chat/`,
});

// Reasoning trio — both reasoning cells share the same backend agent
// (custom-slot vs default-slot is a frontend-only distinction).
agents["agentic-chat-reasoning"] = new HttpAgent({
  url: `${AGENT_URL}/reasoning/`,
});
agents["reasoning-default-render"] = new HttpAgent({
  url: `${AGENT_URL}/reasoning/`,
});
agents["tool-rendering-reasoning-chain"] = new HttpAgent({
  url: `${AGENT_URL}/tool_rendering_reasoning_chain/`,
});

// Interrupt-adapted scheduling demos — both gen-ui-interrupt and
// interrupt-headless share the same backend agent; only the frontend UX
// differs (inline picker in chat vs. external popup).
agents["gen-ui-interrupt"] = new HttpAgent({
  url: `${AGENT_URL}/interrupt/`,
});
agents["interrupt-headless"] = new HttpAgent({
  url: `${AGENT_URL}/interrupt/`,
});

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  console.log(`[copilotkit/route] POST ${url} (content-type: ${contentType})`);

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });

    const response = await handleRequest(req);
    console.log(`[copilotkit/route] Response status: ${response.status}`);
    return response;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    // Log the full error server-side (including stack) but return only a
    // generic message + correlation id to the client. Returning err.message
    // and err.stack to the client leaks internal paths, dependency names,
    // and stack frames — useful for debugging, but unsafe to surface in a
    // production response. Operators correlate via `errorId`.
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    agentStatus = `unreachable (${(e as Error).message})`;
  }

  return NextResponse.json({
    status: "ok",
    agent_url: AGENT_URL,
    agent_status: agentStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
