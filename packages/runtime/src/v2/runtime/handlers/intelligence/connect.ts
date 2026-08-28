import type { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { getPlatformErrorStatus } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

/**
 * Builds browser-facing realtime connection metadata owned by the runtime.
 */
function buildRealtimeConnectionInfo(params: {
  clientUrl: string;
  threadId: string;
}): { clientUrl: string; topic: string } {
  return {
    clientUrl: params.clientUrl,
    topic: `thread:${params.threadId}`,
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
    const status = getPlatformErrorStatus(error);
    const message =
      error instanceof Error ? error.message : "Connect request failed";

    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 409
    ) {
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

    // The platform answered, but with a status we do not special-case above.
    // Pass it through rather than relabelling it: reporting a 503 as a 404 tells
    // the browser the thread does not exist, when the truth is that the platform
    // is temporarily unwell and the request is worth retrying.
    if (typeof status === "number") {
      console.error(`Connect request failed with status ${status}:`, error);
      return Response.json(
        { error: "Connect request failed", message },
        {
          status,
        },
      );
    }

    // No status at all, so this never reached the platform: a socket timeout, a
    // DNS failure, a connection reset, or a bug on our side. 502 says "the thing
    // behind me is unreachable", which is both true and actionable. It must not
    // be a 404, which asserts the thread does not exist and sends the caller off
    // to investigate the wrong thing entirely.
    console.error("Connect request could not reach Intelligence:", error);
    return Response.json(
      {
        error: "Connect request failed",
        message,
      },
      { status: 502 },
    );
  }
}
