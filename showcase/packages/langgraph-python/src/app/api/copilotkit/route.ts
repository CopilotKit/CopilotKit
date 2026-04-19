import { NextRequest, NextResponse } from "next/server";
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
console.log(
  `[copilotkit/route] LANGSMITH_API_KEY: ${process.env.LANGSMITH_API_KEY ? "set" : "not set"}`,
);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: LANGGRAPH_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

// Register the same agent under all names used by demo pages.
// Each demo specifies an agent ID; they all route to the same LangGraph graph.
const agentNames = [
  "agentic_chat",
  "frontend_tools",
  "human_in_the_loop",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
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

// Dedicated-graph agents.
agents["tool-rendering"] = createAgent("tool_rendering");
agents["tool-rendering-default-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-custom-catchall"] = createAgent("tool_rendering");
agents["tool-rendering-reasoning-chain"] = createAgent(
  "tool_rendering_reasoning_chain",
);
// Frontend-tools variant: no backend tools; the frontend owns the tool.
// The generic sample_agent keeps the chat flowing.
agents["tool-rendering-frontend-tools"] = createAgent();
// Declarative Generative UI (A2UI — Dynamic Schema) demo uses its own graph.
agents["declarative-gen-ui"] = createAgent("a2ui_dynamic");
// Hardcoded-catalog variant of dynamic-schema A2UI.
agents["declarative-gen-ui-hardcoded"] = createAgent("a2ui_dynamic_hardcoded");
// Declarative Generative UI (A2UI — Fixed Schema) demo.
agents["a2ui-fixed-schema"] = createAgent("a2ui_fixed");
// Dedicated graphs for stub cells (ported from 4084).
agents["shared-state-streaming"] = createAgent("shared_state_streaming");
agents["subagents"] = createAgent("subagents");
// Reasoning variants.
agents["agentic-chat-reasoning"] = createAgent("reasoning_agent");
agents["reasoning-default-render"] = createAgent("reasoning_agent");
// Interrupt variants.
agents["gen-ui-interrupt"] = createAgent("interrupt_agent");
agents["interrupt-headless"] = createAgent("interrupt_agent");
// HITL dedicated (tools=[] + tailored system prompt).
agents["hitl-in-chat"] = createAgent("hitl_in_chat");
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
  console.log(`[copilotkit/route] POST ${url} (content-type: ${contentType})`);

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        // A2UI middleware — scoped to only the A2UI demos so non-A2UI agents
        // don't get the A2UI tool injected.
        a2ui: {
          injectA2UITool: true,
          agents: [
            "declarative-gen-ui",
            "declarative-gen-ui-hardcoded",
            "a2ui-fixed-schema",
          ],
        },
        // NOTE: OpenGenerativeUI is intentionally NOT enabled here — it
        // lives in /api/copilotkit-ogui so non-OGUI agents keep their
        // per-demo `useFrontendTool` / `useComponent` registrations.
        // MCP Apps is in /api/copilotkit-mcp-apps for the same reason.
      }),
    });

    const response = await handleRequest(req);
    console.log(`[copilotkit/route] Response status: ${response.status}`);
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
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

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
