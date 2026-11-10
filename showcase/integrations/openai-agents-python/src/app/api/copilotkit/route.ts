import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

// The agent backend runs as a separate process on port 8000.
// agent_server.py serves ONE Agents SDK agent per demo at /<agent_name>
// (src/demo_agents/registry.py); this runtime maps each agent name to its
// dedicated backend path.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Health status endpoint served by agent_server's /health route, not by
// the AGENTS registry the agents are served from — kept
// as a named constant, rather than inlined into the fetch call's template
// literal, so it reads distinctly from an agent name in
// tests/python/test_registry.py's route/registry cross-check.
const AGENT_HEALTH_PATH = "health";

// Each agent NAME corresponds to a path mounted by the Python backend
// (see src/demo_agents/registry.py AGENTS). Names with dashes preserved
// for backwards-compat with already-shipped demos.
const agentNames = [
  "agentic_chat",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend_tools",
  "threadid-frontend-tool-roundtrip",
  "frontend-tools-async",
  "hitl-in-chat",
  "hitl-in-app",
  // Interrupt demos: schedule_meeting pauses the run (see interrupt_agent.py).
  "gen-ui-interrupt",
  "interrupt-headless",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "tool-rendering",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  "reasoning-default",
  "reasoning-custom",
  "subagents",
  "shared-state-read",
  "shared-state-read-write",
  "shared-state-streaming",
  "readonly-state-agent-context",
  "default",
];

// Build agents per-request so we can inject inbound x-* headers (e.g.
// x-aimock-context) into the outbound HTTP call to the Python agent_server.
// HttpAgent's `requestInit` spreads `this.headers` into the outbound fetch,
// so populating `headers` from `req.headers` before `copilotHandler` runs
// conveys them to the Python backend, where HeaderForwardingHTTPMiddleware
// records them on a request-scoped ContextVar and the OpenAI client's request
// hook copies the mock/diagnostic ones onto every model call. See
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

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit",
      mode: "single-route",
    });

    return await copilotHandler(req);
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
    const res = await fetch(`${AGENT_URL}/${AGENT_HEALTH_PATH}`, {
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
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
