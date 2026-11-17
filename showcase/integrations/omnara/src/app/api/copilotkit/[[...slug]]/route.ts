import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createAgents } from "@/lib/agents";
import { omnaraConfig, OmnaraConfigurationError } from "@/lib/omnara-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// @region[runtime-setup]
function createHandler() {
  // Validate lazily: builds and health checks need no credentials.
  omnaraConfig(process.env);
  return createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: async () => createAgents(process.env),
      runner: new InMemoryAgentRunner(),
    }),
    basePath: "/api/copilotkit",
  });
}
// @endregion[runtime-setup]

let cached: ReturnType<typeof createHandler> | undefined;
function handler(request: Request) {
  try {
    cached ??= createHandler();
  } catch (error) {
    if (error instanceof OmnaraConfigurationError)
      return Response.json({ error: error.message }, { status: 503 });
    // SDK error messages can contain credentials; log no configuration or payloads.
    console.error("[omnara] Runtime initialization failed.");
    return Response.json(
      { error: "Omnara runtime initialization failed." },
      { status: 500 },
    );
  }
  return cached(request);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
