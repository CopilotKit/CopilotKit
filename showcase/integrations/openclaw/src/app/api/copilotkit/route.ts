import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent, GATEWAY_HEALTH_URL } from "@/lib/openclaw-agent";

// This runtime proxies CopilotKit requests to the OpenClaw gateway's ag-ui
// operator route via the AG-UI protocol. See lib/openclaw-agent.ts.

console.log("[copilotkit/route] Initializing CopilotKit runtime");

function createAgent() {
  return createGatewayAgent();
}

// Register the same agent under all names used by demo pages.
// The OpenClaw gateway is a pass-through: it forwards whatever tools the AG-UI
// client provides (frontend-registered via useFrontendTool / useRenderTool,
// plus runtime-injected tools from openGenerativeUI / a2ui / mcpApps
// middleware) to the model. So distinct agent behaviour across demos comes from
// the frontend, not a per-demo backend graph — every demo can share the same
// gateway target.
const agentNames = [
  // existing demos
  "agentic_chat",
  "agentic-chat",
  "human_in_the_loop",
  "tool-rendering",
  "hitl",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  // newly ported demos
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-chat",
  "hitl-in-chat-booking",
  "hitl-in-app",
  "readonly-state-agent-context",
  // runtime-injected demos (A2UI, open-gen-ui, mcp-apps live on dedicated
  // runtimes; here we register the ids so intra-app links and probe
  // requests resolve cleanly against the default runtime too)
  "declarative-gen-ui",
  "open-gen-ui",
  "open-gen-ui-advanced",
  "mcp-apps",
  // post-#4271 demos — each lives on a dedicated runtime, but we register
  // their agent ids here so probes against the shared runtime resolve
  // without 404s.
  "declarative_json_render",
  "declarative-hashbrown-demo",
  "beautiful-chat",
  "multimodal-demo",
  "voice-demo",
  "agent-config-demo",
  "auth-demo",
  // Interrupt-adapted scheduling demos — both use useFrontendTool with an
  // async handler to simulate LangGraph interrupt(); the backend is the same
  // pass-through agent.
  "gen-ui-interrupt",
  "interrupt-headless",
  // showcase-fill-186 ports — pass-through agents driven by frontend tooling
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  // Reasoning variants — both share the same pass-through agent; differ
  // only in whether the frontend overrides the `messageView.reasoningMessage`
  // slot. Mirrors the canonical LGP topology.
  "reasoning-default",
  "reasoning-custom",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
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
      }),
    });

    const response = await handleRequest(req);
    console.log(`[copilotkit/route] Response status: ${response.status}`);
    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    console.error(`[copilotkit/route] Stack: ${err.stack}`);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
};

export const GET = async () => {
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

  let agentStatus = "unknown";
  try {
    const res = await fetch(GATEWAY_HEALTH_URL, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    agentStatus = `unreachable (${(e as Error).message})`;
  }

  return NextResponse.json({
    status: "ok",
    gateway_health_url: GATEWAY_HEALTH_URL,
    gateway_status: agentStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
