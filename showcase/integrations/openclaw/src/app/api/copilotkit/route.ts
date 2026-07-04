import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// The OpenClaw gateway runs as a separate process. clawg-ui exposes the
// AG-UI protocol at /v1/clawg-ui/operator (operator-auth route: gateway
// token, NO device pairing). The token stays server-side here — the
// browser only talks to /api/copilotkit on this same origin.
const OPERATOR_URL =
  process.env.OPENCLAW_OPERATOR_URL ||
  "http://127.0.0.1:8000/v1/clawg-ui/operator";
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || "";

console.log(`[copilotkit/route] OPERATOR_URL: ${OPERATOR_URL}`);
console.log(
  `[copilotkit/route] GATEWAY_TOKEN: ${GATEWAY_TOKEN ? "set" : "NOT SET"}`,
);

function createAgent(): AbstractAgent {
  return new HttpAgent({
    url: OPERATOR_URL,
    headers: GATEWAY_TOKEN
      ? { Authorization: `Bearer ${GATEWAY_TOKEN}` }
      : {},
  });
}

// v1 scope: agentic chat + server tool-rendering. Both map to the same
// OpenClaw agent; register under the demo agent names the pages use.
// All demo agent names proxy to the same OpenClaw agent (via the operator
// route). Frontend-presentation demos (sidebar/popup/CSS) are pure UI
// variations over the same event stream.
const agents: Record<string, AbstractAgent> = {
  agentic_chat: createAgent(),
  "agentic-chat-reasoning": createAgent(),
  "tool-rendering": createAgent(),
  "frontend-tools": createAgent(),
  "hitl-in-chat": createAgent(),
  "hitl-in-app": createAgent(),
  "prebuilt-sidebar": createAgent(),
  "prebuilt-popup": createAgent(),
  "chat-customization-css": createAgent(),
  "chat-slots": createAgent(),
  "reasoning-custom": createAgent(),
  hitl: createAgent(),
  "agent-config": createAgent(),
  "frontend-tools-async": createAgent(),
  "readonly-state-agent-context": createAgent(),
  "gen-ui-agent": createAgent(),
  "gen-ui-tool-based": createAgent(),
  "tool-rendering-default-catchall": createAgent(),
  "tool-rendering-custom-catchall": createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- published CopilotRuntime agents type is over-strict; plain Record is fine
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({ scope: "copilotkit/route", errorId, message: err.message, stack: err.stack }),
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
    const base = OPERATOR_URL.replace(/\/v1\/clawg-ui\/operator\/?$/, "/");
    const res = await fetch(base, { signal: AbortSignal.timeout(3000) });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    agentStatus = `unreachable (${(e as Error).message})`;
  }
  return NextResponse.json({
    status: "ok",
    operator_url: OPERATOR_URL,
    gateway_status: agentStatus,
    gateway_token: GATEWAY_TOKEN ? "set" : "NOT SET",
  });
};
