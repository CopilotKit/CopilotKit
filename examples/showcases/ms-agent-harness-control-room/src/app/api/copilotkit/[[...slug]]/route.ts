import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitIntelligence,
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import type { NextRequest } from "next/server";

import { CONTROL_ROOM_AGENT_NAME } from "@/lib/control-room-agent";
import {
  CONTROL_ROOM_ENDPOINT_HEADER,
  resolveEndpointHeader,
} from "@/lib/endpoint";
import { ControlRoomA2UIStreamingMiddleware } from "@/lib/control-room-a2ui-streaming-middleware";
import { NormalizeToolResultMessageIdsMiddleware } from "@/lib/normalize-tool-result-message-ids";

function resolveAgentEndpoint(headers: Headers): string {
  const resolved = resolveEndpointHeader(
    headers.get(CONTROL_ROOM_ENDPOINT_HEADER),
  );
  if ("errorResponse" in resolved) {
    throw new Error("Invalid control room endpoint header");
  }
  return resolved.endpoint;
}

const agents = ({ request }: { request: Request }) => ({
  [CONTROL_ROOM_AGENT_NAME]: new HttpAgent({
    url: resolveAgentEndpoint(request.headers),
  })
    .use(new ControlRoomA2UIStreamingMiddleware())
    .use(new NormalizeToolResultMessageIdsMiddleware()),
});

/**
 * Resolves the CopilotKit Intelligence connection from the environment.
 *
 * All three variables present → Intelligence mode (durable threads,
 * realtime sync, observability). None present → in-memory SSE mode so
 * local `pnpm dev` needs zero extra setup. A partial set is a
 * misconfiguration and fails loudly instead of silently degrading.
 */
function resolveIntelligence(): CopilotKitIntelligence | undefined {
  const env = {
    INTELLIGENCE_API_URL: process.env.INTELLIGENCE_API_URL,
    INTELLIGENCE_GATEWAY_WS_URL: process.env.INTELLIGENCE_GATEWAY_WS_URL,
    INTELLIGENCE_API_KEY: process.env.INTELLIGENCE_API_KEY,
  };
  const missing = Object.entries(env)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length === Object.keys(env).length) {
    return undefined;
  }
  if (missing.length > 0) {
    throw new Error(
      `CopilotKit Intelligence is partially configured. Missing: ${missing.join(", ")}. ` +
        "Set all three INTELLIGENCE_* variables to enable Intelligence, or unset them all for local in-memory mode.",
    );
  }
  return new CopilotKitIntelligence({
    apiUrl: env.INTELLIGENCE_API_URL!,
    wsUrl: env.INTELLIGENCE_GATEWAY_WS_URL!,
    apiKey: env.INTELLIGENCE_API_KEY!,
  });
}

function buildRuntime(): CopilotRuntime {
  const intelligence = resolveIntelligence();
  if (intelligence) {
    return new CopilotRuntime({
      agents,
      intelligence,
      // Public showcase with no auth: every visitor shares one demo
      // identity, so the thread list is shared and realtime sync across
      // browsers is itself part of the demo. The id must be a user that
      // already exists in the Intelligence organization — the platform
      // does not auto-provision users and fails thread creation for
      // unknown ids.
      identifyUser: () => ({
        id: "jordan-beamson",
        name: "Jordan Beamson",
      }),
      openGenerativeUI: true,
    });
  }
  return new CopilotRuntime({
    agents,
    runner: new InMemoryAgentRunner(),
    openGenerativeUI: true,
  });
}

// Constructed lazily so env resolution happens in the running server
// process (Railway injects INTELLIGENCE_* at run time), never during
// `next build` inside the Docker image where they are absent.
let app: ReturnType<typeof createCopilotEndpoint> | undefined;

function getApp(): NonNullable<typeof app> {
  app ??= createCopilotEndpoint({
    runtime: buildRuntime(),
    basePath: "/api/copilotkit",
  });
  return app;
}

function handleCopilotRequest(req: NextRequest) {
  const resolved = resolveEndpointHeader(
    req.headers.get(CONTROL_ROOM_ENDPOINT_HEADER),
  );
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  return getApp().fetch(req);
}

export const GET = handleCopilotRequest;

export const POST = handleCopilotRequest;

// Intelligence thread management: rename/archive are PATCH, delete is
// DELETE. Next.js returns 405 for any method the route doesn't export.
export const PATCH = handleCopilotRequest;

export const DELETE = handleCopilotRequest;
