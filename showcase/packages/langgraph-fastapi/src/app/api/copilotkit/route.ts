import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: `${AGENT_URL}/`,
    graphId,
  });
}

const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
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

// Interrupt variants — share the dedicated `interrupt_agent` graph that uses
// langgraph's `interrupt()` primitive inside `schedule_meeting`.
agents["gen-ui-interrupt"] = createAgent("interrupt_agent");
agents["interrupt-headless"] = createAgent("interrupt_agent");

// Dedicated-graph agents — each cell has its own LangGraph graph with a
// tailored system prompt (tools=[], CopilotKitMiddleware attached).
agents["frontend_tools"] = createAgent("frontend_tools");
agents["frontend-tools-async"] = createAgent("frontend_tools_async");
agents["hitl-in-app"] = createAgent("hitl_in_app");
agents["readonly-state-agent-context"] = createAgent(
  "readonly_state_agent_context",
);

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
    console.log(`[copilotkit/route] Response status: ${response.status}`);
    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 500 });
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
