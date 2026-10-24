import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createDefaultAgent } from "@/app/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One runtime per module load, so development reloads apply code and env edits. */
function createHandler() {
  // The mock endpoint bypasses Intelligence as well as Omnara.
  if (process.env.AGENT_URL)
    return createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        agents: { default: createDefaultAgent() },
        runner: new InMemoryAgentRunner(),
      }),
      basePath: "/api/copilotkit",
    });
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: { default: createDefaultAgent() },
      // --- copilotkit:intelligence (remove this block to opt out) ---
      ...(process.env.CPK_INTELLIGENCE_API_KEY
        ? {
            intelligence: new CopilotKitIntelligence({
              apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
              ...(process.env.INTELLIGENCE_API_URL
                ? { apiUrl: process.env.INTELLIGENCE_API_URL }
                : {}),
              ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
                ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
                : {}),
            }),
            // Demo stub — replace with your real auth-derived user identity before any
            // multi-user deployment, or all users share one thread history. The id
            // must correspond to a user that exists in CopilotKit Intelligence;
            // an unknown id (like this literal) can make thread operations fail.
            identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
          }
        : { runner: new InMemoryAgentRunner() }),
      // --- /copilotkit:intelligence ---
    }),
    basePath: "/api/copilotkit",
  });
}

let cached: ReturnType<typeof createHandler> | undefined;
/** Lazily configure on the server so builds need no credentials. */
function handler() {
  return (cached ??= createHandler());
}
export const GET = (request: Request) => handler()(request);
export const POST = (request: Request) => handler()(request);
export const PATCH = (request: Request) => handler()(request);
export const DELETE = (request: Request) => handler()(request);
