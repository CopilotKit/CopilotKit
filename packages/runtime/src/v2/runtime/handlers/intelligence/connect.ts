import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { isPlatformNotFoundError } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

interface HandleIntelligenceConnectParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  threadId: string;
  lastSeenEventId: string | null;
}

export async function handleIntelligenceConnect({
  runtime,
  request,
  threadId,
  lastSeenEventId,
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
      lastSeenEventId,
    });

    if (result === null) {
      return new Response(null, {
        status: 204,
      });
    }

    return Response.json(result, {
      headers: { "Cache-Control": "no-cache", Connection: "keep-alive" },
    });
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
