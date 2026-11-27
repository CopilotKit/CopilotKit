import {
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createAgents } from "@/lib/agents";
import { omnaraConfig, OmnaraConfigurationError } from "@/lib/omnara-config";
import { createVisitorSessions } from "@/lib/visitor-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const basePath = "/api/copilotkit";

// @region[runtime-setup]
function createHandler() {
  // Validate lazily: builds and health checks need no credentials.
  omnaraConfig(process.env);
  const sessions = createVisitorSessions();
  const runtimeHandler = createCopilotRuntimeHandler({
    runtime: new CopilotRuntime({
      agents: ({ request }) =>
        createAgents(process.env, sessions.requireSession(request).threadId),
      runner: new InMemoryAgentRunner(),
      forwardHeaders: { deny: ["authorization"] },
    }),
    basePath,
    hooks: {
      async onBeforeHandler({ request, route }) {
        const session = sessions.requireSession(request);
        switch (route.method) {
          case "info":
          case "inspector/metadata":
            return;
          case "agent/run":
          case "agent/connect":
          case "agent/stop": {
            const threadId =
              route.method === "agent/stop"
                ? route.threadId
                : (
                    await request
                      .clone()
                      .json()
                      .catch(() => null)
                  )?.threadId;
            if (
              route.agentId !== session.agentId ||
              threadId !== session.threadId
            ) {
              throw Response.json(
                { error: "Thread access denied." },
                { status: 403 },
              );
            }
            return;
          }
          default:
            throw Response.json({ error: "Not found." }, { status: 404 });
        }
      },
    },
  });
  return (request: Request) =>
    request.method === "POST" &&
    new URL(request.url).pathname === `${basePath}/session`
      ? sessions.startOrResume(request)
      : runtimeHandler(request);
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
