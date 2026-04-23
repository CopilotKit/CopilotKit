import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { isPlatformNotFoundError } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

interface HandleIntelligenceConnectParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
  runId: string;
}

export async function handleIntelligenceConnect({
  runtime,
  request,
  agentId,
  threadId,
  runId,
}: HandleIntelligenceConnectParams): Promise<Response> {
  if (!runtime.intelligence) {
    return Response.json(
      {
        error: "Intelligence not configured",
        message: "Intelligence mode requires a CopilotKitIntelligence",
      },
      { status: 500 },
    );
  }

  try {
    const user = await resolveIntelligenceUser({ runtime, request });
    if (isHandlerResponse(user)) {
      return user;
    }

    const result = await runtime.intelligence.ɵconnectThread({
      threadId,
      userId: user.id,
      agentId,
    });

    if (result === null) {
      return new Response(null, {
        status: 204,
      });
    }

    return Response.json(
      {
        threadId: result.threadId,
        runId,
        joinToken: result.joinToken,
        intelligence: { wsUrl: runtime.intelligence.ɵgetClientWsUrl() },
      },
      {
        headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
      },
    );
  } catch (error) {
    if (isPlatformNotFoundError(error)) {
      return new Response(null, {
        status: 204,
      });
    }

    console.error("Connect plan not available:", error);
    return Response.json(
      {
        error: "Connect plan not available",
      },
      { status: 404 },
    );
  }
}
