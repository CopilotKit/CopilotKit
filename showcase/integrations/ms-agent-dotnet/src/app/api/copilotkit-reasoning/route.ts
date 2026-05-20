import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// Dedicated runtime route for the reasoning demos.
//
// The .NET agent backend mounts two AG-UI endpoints on port 8000:
//   - `/`           — SalesAgent (everything else)
//   - `/reasoning`  — ReasoningAgent (this route)
//
// Both reasoning demo pages (`agentic-chat-reasoning`,
// `reasoning-default-render`) share the same backend agent. Keeping the
// reasoning mapping in its own route file avoids touching the main
// `/api/copilotkit` route at all.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit-reasoning/route] Initializing reasoning runtime");
console.log(`[copilotkit-reasoning/route] AGENT_URL: ${AGENT_URL}`);

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/reasoning` });
}

// Both reasoning demo pages point at this runtime via `runtimeUrl` and use
// one of these agent names. The underlying HttpAgent is identical — only
// the agent name differs so the two demo pages can be independently
// addressable from the runtime's agent registry.
const agentNames = ["agentic-chat-reasoning", "reasoning-default-render"];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
agents["default"] = createAgent();

console.log(
  `[copilotkit-reasoning/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  console.log(
    `[copilotkit-reasoning/route] POST ${url} (content-type: ${contentType})`,
  );

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-reasoning",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });

    const response = await handleRequest(req);
    console.log(
      `[copilotkit-reasoning/route] Response status: ${response.status}`,
    );
    return response;
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`[copilotkit-reasoning/route] ERROR: ${err.message}`);
    console.error(`[copilotkit-reasoning/route] Stack: ${err.stack}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  console.log("[copilotkit-reasoning/route] GET /api/copilotkit-reasoning");

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
    agent_url: `${AGENT_URL}/reasoning`,
    agent_status: agentStatus,
    env: {
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
