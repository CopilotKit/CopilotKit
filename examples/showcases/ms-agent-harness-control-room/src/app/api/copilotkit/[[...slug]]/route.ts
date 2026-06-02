import { HttpAgent } from "@ag-ui/client";
import {
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

const copilotRuntime = new CopilotRuntime({
  agents: ({ request }) => ({
    [CONTROL_ROOM_AGENT_NAME]: new HttpAgent({
      url: resolveAgentEndpoint(request.headers),
    })
      .use(new ControlRoomA2UIStreamingMiddleware())
      .use(new NormalizeToolResultMessageIdsMiddleware()),
  }),
  runner: new InMemoryAgentRunner(),
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
});

function handleCopilotRequest(req: NextRequest) {
  const resolved = resolveEndpointHeader(
    req.headers.get(CONTROL_ROOM_ENDPOINT_HEADER),
  );
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  return app.fetch(req);
}

export const GET = handleCopilotRequest;

export const POST = handleCopilotRequest;
