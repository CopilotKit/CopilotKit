import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

// The agent backend runs as a separate process on port 8000.
// agent_server.py mounts ONE ADKAgent middleware per demo at /<agent_name>;
// this runtime maps each agent name to its dedicated backend path.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Each agent NAME corresponds to a path mounted by the Python backend
// (see src/agents/registry.py AGENT_REGISTRY). Names with dashes preserved
// for backwards-compat with already-shipped demos (gen-ui-agent etc.).
const agentNames = [
  // existing demos
  "agentic_chat",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  // frontend-only demos (share simple chat agent on the backend)
  "frontend_tools",
  "threadid-frontend-tool-roundtrip",
  "frontend-tools-async",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless_complete",
  "voice",
  // reasoning
  "reasoning-custom",
  "reasoning-default",
  // tool-rendering variants
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  // hitl variants
  "hitl-in-chat",
  "hitl-in-app",
  "human_in_the_loop",
  // gen-ui-interrupt: Strategy-B scheduling flow (schedule_meeting frontend
  // tool via useHumanInTheLoop). Page binds agentId="gen-ui-interrupt".
  "gen-ui-interrupt",
  // multimodal & state-context
  "multimodal",
  "readonly-state-agent-context",
  "agent_config",
  // a2ui
  "declarative_gen_ui",
  "a2ui_fixed_schema",
  // byoc / declarative
  "declarative-hashbrown",
  "byoc_json_render",
  // open gen ui
  "open_gen_ui",
  "open_gen_ui_advanced",
  // beautiful chat
  "beautiful_chat",
  // auth
  "auth",
  // mcp apps (also wired via separate runtime route copilotkit-mcp-apps)
  "mcp-apps",
  // Neutral default agent. The hitl demo's `useInterrupt` hook binds to
  // the default agent (no agentId), so a `default` slot must exist or the
  // page throws `useAgent: Agent 'default' not found`. Mirrors
  // langgraph-python's `agents["default"]`.
  "default",
];

// Build agents per-request so we can inject inbound x-* headers (e.g.
// x-aimock-context) into the outbound HTTP call to the Python agent_server.
// HttpAgent's `requestInit` spreads `this.headers` into the outbound fetch,
// so populating `headers` from `req.headers` before `handleRequest` runs
// is sufficient to convey the header to the Python backend, where
// HeaderForwardingHTTPMiddleware then propagates it to Gemini via the
// httpx/aiohttp event hooks installed at import time. See
// `src/lib/header-forwarding.ts` for the shared helper.
function buildAgents(
  headers: Record<string, string>,
): Record<string, AbstractAgent> {
  const agents: Record<string, AbstractAgent> = {};
  for (const name of agentNames) {
    agents[name] = new HttpAgent({ url: `${AGENT_URL}/${name}`, headers });
  }
  return agents;
}

// Module-load cache used only for the agent_count health probe — never
// receives request headers, so it is not used for actual POST traffic.
const healthProbeAgents = buildAgents({});

export const POST = async (req: NextRequest) => {
  try {
    const forwardedHeaders = extractForwardedHeaders(req);
    const agents = buildAgents(forwardedHeaders);

    const runtime = new CopilotRuntime({
      agents,
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });

    return await handleRequest(req);
  } catch (error: unknown) {
    // Log full details server-side (operators grep `errorId` to correlate),
    // but never echo `err.message` / `err.stack` back to the HTTP client —
    // that leaks internal paths, dependency versions, and stack traces.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        scope: "copilotkit",
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
    agent_count: Object.keys(healthProbeAgents).length,
    env: {
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
