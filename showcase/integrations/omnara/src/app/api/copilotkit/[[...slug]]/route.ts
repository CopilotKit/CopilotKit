import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createAgents } from "@/lib/agents";
import { omnaraConfig } from "@/lib/omnara-config";

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
  } catch {
    return Response.json(
      {
        error:
          "Omnara setup is incomplete. Configure OMNARA_API_KEY, OMNARA_ORG_ID, OMNARA_PROJECT_ID and OMNARA_PROFILE on the server. See the integration README.",
      },
      { status: 503 },
    );
  }
  return cached(request);
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
