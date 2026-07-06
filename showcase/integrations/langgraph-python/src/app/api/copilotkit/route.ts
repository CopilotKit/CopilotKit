import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] LANGGRAPH_URL: ${LANGGRAPH_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";
console.log(
  `[copilotkit/route] LANGSMITH_API_KEY: ${process.env.LANGSMITH_API_KEY ? "set" : "not set"}`,
);

function createAgent(
  graphId: string = "sample_agent",
  options: { recursionLimit?: number } = {},
) {
  // LangGraph's `recursion_limit` defaults to 25 (langchain_core), and
  // `with_config` in Python doesn't propagate when the graph is invoked via
  // the langgraph server's runs API — the wrapper isn't visible to the
  // assistant config. Bake the limit into `assistantConfig` here so it
  // travels with every run we kick off through this route.
  return new LangGraphAgent({
    deploymentUrl: LANGGRAPH_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
    assistantConfig: { recursion_limit: options.recursionLimit ?? 100 },
  });
}

// Cells that share the neutral default "helpful, concise assistant" graph.
// These cells are chrome / UI / docs demos — the agent has no specialized
// behavior. Each still gets its own registered name so per-cell frontend
// tool/component registrations scope correctly.
const neutralAssistantCells = [
  "human_in_the_loop",
  "shared-state-read",
  "shared-state-write",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  // NOTE: `beautiful-chat` is NOT in this list — it has its own dedicated
  // runtime at /api/copilotkit-beautiful-chat (needed for openGenerativeUI +
  // a2ui + mcpApps combined-runtime shape). See the beautiful-chat page.tsx.
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of neutralAssistantCells) {
  agents[name] = createAgent();
}

// Dedicated-graph agents.
agents["tool-rendering"] = createAgent("tool_rendering");
agents["tool-rendering-default-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-custom-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-reasoning-chain"] = createAgent(
  "tool_rendering_reasoning_chain",
);
// Declarative Generative UI (A2UI — Dynamic Schema) demo uses its own graph.
agents["declarative-gen-ui"] = createAgent("a2ui_dynamic");
// Declarative Generative UI (A2UI — Fixed Schema) demo.
agents["a2ui-fixed-schema"] = createAgent("a2ui_fixed");
// Dedicated graphs for stub cells (ported from 4084).
agents["shared-state-streaming"] = createAgent("shared_state_streaming");
agents["subagents"] = createAgent("subagents");
// Basic cells with their own dedicated graphs (neutral assistant variants
// split out of main.py so main.py stays a pure default).
agents["agentic_chat"] = createAgent("agentic_chat");
agents["frontend_tools"] = createAgent("frontend_tools");
agents["threadid-frontend-tool-roundtrip"] = createAgent("frontend_tools");
// Frontend Tools (Async) — dedicated cell demonstrating an async useFrontendTool
// handler (simulated client-side notes DB query). Backend has no tools; the
// frontend registers `query_notes` via useFrontendTool and the agent awaits
// its returned result.
agents["frontend-tools-async"] = createAgent("frontend_tools_async");
agents["gen-ui-agent"] = createAgent("gen_ui_agent");
// Tool-Based Generative UI — chart-viz system prompt lives in its own graph.
agents["gen-ui-tool-based"] = createAgent("gen_ui_tool_based");
// Reasoning variants. The Custom demo (`reasoning-custom`) and the
// Default demo (`reasoning-default`) both share the same backend graph;
// the only difference is whether the frontend overrides the
// `messageView.reasoningMessage` slot.
agents["reasoning-custom"] = createAgent("reasoning_agent");
agents["reasoning-default"] = createAgent("reasoning_agent");
// Interrupt variants.
agents["gen-ui-interrupt"] = createAgent("interrupt_agent");
agents["interrupt-headless"] = createAgent("interrupt_agent");
// HITL dedicated (tools=[] + tailored system prompt).
agents["hitl-in-chat"] = createAgent("hitl_in_chat");
// In-App HITL — async frontend-tool + app-level modal (outside chat).
agents["hitl-in-app"] = createAgent("hitl_in_app");
// Shared state R+W and read-only agent context.
agents["shared-state-read-write"] = createAgent("shared_state_read_write");
agents["readonly-state-agent-context"] = createAgent(
  "readonly_state_agent_context",
);

// Also register a default
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  if (ROUTE_DEBUG) {
    console.log(
      `[copilotkit/route] POST ${url} (content-type: ${contentType})`,
    );
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        // NOTE: A2UI is intentionally NOT enabled here. The A2UI cells
        // (declarative-gen-ui and a2ui-fixed-schema) each live on their own
        // dedicated runtime endpoint (/api/copilotkit-declarative-gen-ui and
        // /api/copilotkit-a2ui-fixed-schema respectively), mirroring the
        // beautiful-chat topology. The dynamic-schema cells
        // (declarative-gen-ui, beautiful-chat) set `a2ui.injectA2UITool: true`
        // so the runtime injects `generate_a2ui` and the agent's
        // CopilotKitMiddleware auto-executes it; the fixed-schema cell sets
        // `false` because that agent owns its `display_flight` tool explicitly.
        // OpenGenerativeUI lives in /api/copilotkit-ogui for the same reason.
        // MCP Apps is in /api/copilotkit-mcp-apps.
      }),
    });

    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    } else if (ROUTE_DEBUG) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    }
    return response;
  } catch (error: any) {
    console.error(`[copilotkit/route] ERROR: ${error.message}`);
    console.error(`[copilotkit/route] Stack: ${error.stack}`);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  if (ROUTE_DEBUG) {
    console.log("[copilotkit/route] GET /api/copilotkit (health probe)");
  }

  let langGraphStatus = "unknown";
  try {
    const res = await fetch(`${LANGGRAPH_URL}/ok`, {
      signal: AbortSignal.timeout(3000),
    });
    langGraphStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: any) {
    langGraphStatus = `unreachable (${e.message})`;
  }

  return NextResponse.json({
    status: "ok",
    langgraph_url: LANGGRAPH_URL,
    langgraph_status: langGraphStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
