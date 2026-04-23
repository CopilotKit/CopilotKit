import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import {
  getPlatformErrorStatus,
  isPlatformNotFoundError,
} from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

/**
 * Builds browser-facing realtime connection metadata owned by the runtime.
 */
function buildRealtimeConnectionInfo(params: {
  clientUrl: string;
  threadId: string;
}): { clientUrl: string; threadTopic: string } {
  return {
    clientUrl: params.clientUrl,
    threadTopic: `thread:${params.threadId}`,
  };
}

interface HandleIntelligenceConnectParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  agentId: string;
  threadId: string;
}

export async function handleIntelligenceConnect({
  runtime,
  request,
  agentId,
  threadId,
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
        joinToken: result.joinToken,
        realtime: buildRealtimeConnectionInfo({
          clientUrl: runtime.intelligence.ɵgetClientWsUrl(),
          threadId: result.threadId,
        }),
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

    const status = getPlatformErrorStatus(error);
    if (status === 400 || status === 401 || status === 403 || status === 409) {
      return Response.json(
        {
          error: "Connect request rejected",
          message:
            error instanceof Error
              ? error.message
              : "Intelligence platform rejected the connect request",
        },
        { status },
      );
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
