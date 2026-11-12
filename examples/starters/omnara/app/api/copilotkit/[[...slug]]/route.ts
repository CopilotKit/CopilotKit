import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createDefaultAgent } from "@/app/agent";
import { intelligenceConfig } from "@/lib/intelligence-config";

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
  const config = intelligenceConfig(process.env);
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: { default: createDefaultAgent() },
      intelligence: new CopilotKitIntelligence(config.intelligence),
      // This localhost starter has one developer identity. Replace with verified
      // request authentication before exposing it to multiple users.
      identifyUser: () => ({ id: config.userId, name: "Local Developer" }),
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
