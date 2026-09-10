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
// agent_server.py mounts ONE AntigravityAgent per demo at /<agent_name>
// via create_antigravity_app; this runtime maps each agent name to its
// dedicated backend path.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Health status endpoint mounted by agent_server's HealthMiddleware, not by
// the AGENT_REGISTRY the AntigravityAgent instances are mounted from — kept
// as a named constant, rather than inlined into the fetch call's template
// literal, so it reads distinctly from an agent name in
// tests/python/test_registry.py's route/registry cross-check.
const AGENT_HEALTH_PATH = "health";

// Each agent NAME corresponds to a path mounted by the Python backend
// (see src/agents/registry.py AGENT_REGISTRY). Names with dashes preserved
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
  "gen-ui-tool-based",
  "tool-rendering",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  "reasoning-default",
  "reasoning-custom",
  "subagents",
  "default",
];

// Build agents per-request so we can inject inbound x-* headers (e.g.
// x-aimock-context) into the outbound HTTP call to the Python agent_server.
// HttpAgent's `requestInit` spreads `this.headers` into the outbound fetch,
// so populating `headers` from `req.headers` before `copilotHandler` runs
// is sufficient to convey the header to the Python backend, where
// HeaderForwardingHTTPMiddleware records it for any Python-side httpx call
// (e.g. the subagent tools' chat completions). The Go harness makes the
// actual model call itself, so this conveyance cannot cross that hop; the
// static `X-AIMock-Context` header is stamped separately by the OpenAI
// shim (src/openai_proxy.py) — see PARITY_NOTES.md. See
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
