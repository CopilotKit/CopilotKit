import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";
import crypto from "node:crypto";

// Emit a structured server-side error log with a correlation id so the
// 500 we return to the client carries no stack/message details (which
// can leak internal config, prompts, or upstream URLs) while operators
// can still grep logs for the same `errorId` to find the full failure.
function logRouteError(err: unknown): string {
  const error = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      phase: "setup",
      errorId,
      message: error.message,
      stack: error.stack,
    }),
  );
  return errorId;
}

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createAgent(
  graphId: string = "sample_agent",
  options: { recursionLimit?: number } = {},
) {
  // LangGraph's `recursion_limit` defaults to 25 (langchain_core), and
  // `with_config` in Python doesn't propagate when the graph is invoked via
  // the langgraph server's runs API — the `.with_config(...)` wrapper on the
  // graph object isn't visible to the assistant config the server builds per
  // run. Bake the limit into `assistantConfig` here so it travels with every
  // run we kick off through this route. Without this, multi-step graphs like
  // `gen_ui_agent` (which walks ~15 supersteps of set_steps calls, more once
  // prior turns accumulate in the thread) hit the default 25 mid-run and the
  // final state-publishing tool call never streams — the state card then
  // shows stale content from the previous pill. Mirrors langgraph-python.
  return new LangGraphAgent({
    deploymentUrl: `${AGENT_URL}/`,
    graphId,
    assistantConfig: { recursion_limit: options.recursionLimit ?? 100 },
  });
}

const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "gen-ui-tool-based",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

// Dedicated-graph agents for tool-rendering + reasoning demos.
agents["tool-rendering"] = createAgent("tool_rendering");
agents["tool-rendering-default-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-custom-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-reasoning-chain"] = createAgent(
  "tool_rendering_reasoning_chain",
);
agents["agentic-chat-reasoning"] = createAgent("reasoning_agent");
agents["reasoning-default-render"] = createAgent("reasoning_agent");

// Agentic Generative UI — dedicated `gen_ui_agent` graph. The agent defines
// its own `steps` state + a `set_steps` tool the model calls to publish plan
// progress; the frontend subscribes via `useAgent`. Previously this name fell
// through the neutral-assistant loop to `sample_agent`, which has no `steps`
// state or `set_steps` tool, so the demo never rendered a progress card.
agents["gen-ui-agent"] = createAgent("gen_ui_agent");

// Interrupt variants — share the dedicated `interrupt_agent` graph that uses
// langgraph's `interrupt()` primitive inside `schedule_meeting`.
agents["gen-ui-interrupt"] = createAgent("interrupt_agent");
agents["interrupt-headless"] = createAgent("interrupt_agent");

// Dedicated-graph agents — each cell has its own LangGraph graph with a
// tailored system prompt (tools=[], CopilotKitMiddleware attached).
agents["frontend_tools"] = createAgent("frontend_tools");
agents["frontend-tools-async"] = createAgent("frontend_tools_async");
agents["hitl-in-app"] = createAgent("hitl_in_app");
// In-Chat HITL via the high-level `useHumanInTheLoop` hook — backend
// agent has zero tools; the frontend-registered `book_call` tool is
// injected into the LLM's tool list by `CopilotKitMiddleware`. Both
// the canonical `hitl-in-chat` demo and the `hitl-in-chat-booking`
// alias share the same backend graph.
agents["hitl-in-chat"] = createAgent("hitl_in_chat");
agents["hitl-in-chat-booking"] = createAgent("hitl_in_chat");
// HITL step-selection: dedicated graph with tools=[] + CopilotKitMiddleware.
// The `human_in_the_loop` alias in the neutral-assistant loop above maps to
// `sample_agent` which has 7+ backend tools and a custom AgentState — the
// frontend-only `generate_task_steps` tool (from useHumanInTheLoop) is the
// ONLY tool this demo needs, so a minimal graph avoids state/tool contention.
agents["human_in_the_loop"] = createAgent("hitl_steps");
agents["readonly-state-agent-context"] = createAgent(
  "readonly_state_agent_context",
);

// Shared State (Read + Write) — bidirectional shared state between UI and
// agent. UI writes `preferences` via agent.setState; middleware reads them
// into the system prompt; agent writes `notes` back via the `set_notes` tool.
agents["shared-state-read-write"] = createAgent("shared_state_read_write");

// Sub-Agents — supervisor delegates to research_agent / writing_agent /
// critique_agent (each a full create_agent under the hood). Every delegation
// is appended to `state.delegations` for live UI rendering.
agents["subagents"] = createAgent("subagents");

agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore
        agents,
      }),
    });

    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    } else if (ROUTE_DEBUG) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    }
    return response;
  } catch (error: unknown) {
    // Log full message + stack server-side under a correlation id; return
    // only the id to the client so we don't leak internal details (upstream
    // URLs, env-driven config, prompts, etc.) into HTTP responses.
    const errorId = logRouteError(error);
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/ok`, {
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
  });
};
