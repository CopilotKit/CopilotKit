import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// The agent backend runs as a separate process on port 8000.
// agent_server.py mounts ONE ADKAgent middleware per demo at /<agent_name>;
// this runtime maps each agent name to its dedicated backend path.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

// Each agent NAME corresponds to a path mounted by the Python backend
// (see src/agents/registry.py AGENT_REGISTRY). Names with dashes preserved
// for backwards-compat with already-shipped demos (gen-ui-agent etc.).
const agentNames = [
  // existing demos
  "agentic_chat",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "human_in_the_loop",
  "shared-state-read",
  "shared-state-write",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  // frontend-only demos (share simple chat agent on the backend)
  "frontend_tools",
  "frontend_tools_async",
  "prebuilt_sidebar",
  "prebuilt_popup",
  "chat_slots",
  "chat_customization_css",
  "headless_simple",
  "headless_complete",
  "voice",
  // reasoning
  "agentic_chat_reasoning",
  "reasoning_default_render",
  // tool-rendering variants
  "tool_rendering_default_catchall",
  "tool_rendering_custom_catchall",
  "tool_rendering_reasoning_chain",
  // hitl variants
  "hitl_in_chat",
  "hitl_in_app",
  // multimodal & state-context
  "multimodal",
  "readonly_state_agent_context",
  "agent_config",
  // a2ui
  "declarative_gen_ui",
  "a2ui_fixed_schema",
  // byoc
  "byoc_hashbrown",
  "byoc_json_render",
  // open gen ui
  "open_gen_ui",
  "open_gen_ui_advanced",
  // beautiful chat
  "beautiful_chat",
  // auth
  "auth",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = new HttpAgent({ url: `${AGENT_URL}/${name}` });
}

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agents.`,
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
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
        // MaybePromise<NonEmptyRecord<...>> which rejects plain Records;
        // fixed in source, pending release.
        agents,
      }),
    });

    const response = await handleRequest(req);
    console.log(`[copilotkit/route] Response status: ${response.status}`);
    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    console.error(`[copilotkit/route] Stack: ${err.stack}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
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
    agent_count: Object.keys(agents).length,
    env: {
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
