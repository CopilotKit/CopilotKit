import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import { getPlatformErrorStatus } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";
import { logger } from "@copilotkit/shared";
import type { ConnectRestoreParameters } from "../shared/agent-utils";
import {
  InvalidConnectResponseError,
  type ConnectThreadResponse,
} from "../../intelligence-platform/client";

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
  restore: ConnectRestoreParameters;
}

function summarizeInvalidConnectResult(
  result: NonNullable<ConnectThreadResponse>,
): {
  canonicalThreadId?: string;
  hasJoinToken: boolean;
  fields: string[];
} {
  const candidate = result as Record<string, unknown>;

  return {
    ...(typeof result.threadId === "string"
      ? { canonicalThreadId: result.threadId }
      : {}),
    hasJoinToken:
      typeof candidate.joinToken === "string" && candidate.joinToken.length > 0,
    fields: Object.keys(candidate),
  };
}

function hasConnectResponseFields(
  result: ConnectThreadResponse,
): result is NonNullable<ConnectThreadResponse> {
  return (
    result !== null &&
    typeof result.threadId === "string" &&
    result.threadId.length > 0 &&
    typeof result.joinToken === "string" &&
    result.joinToken.length > 0
  );
}

export async function handleIntelligenceConnect({
  runtime,
  request,
  agentId,
  threadId,
  restore,
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
      ...restore,
    });

    if (result === null) {
      return new Response(null, {
        status: 204,
      });
    }

    if (!hasConnectResponseFields(result)) {
      logger.error(
        {
          threadId,
          agentId,
          resultSummary: summarizeInvalidConnectResult(result),
        },
        "Intelligence connect returned malformed credentials",
      );
      return Response.json(
        {
          error: "Connect response invalid",
          message:
            "Intelligence platform did not return canonical threadId and joinToken",
        },
        { status: 502 },
      );
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
    if (error instanceof InvalidConnectResponseError) {
      logger.error(
        {
          err: error,
          threadId,
          agentId,
        },
        "Intelligence connect returned invalid response",
      );
      return Response.json(
        {
          error: "Connect response invalid",
          message: error.message,
        },
        { status: 502 },
      );
    }

    const status = getPlatformErrorStatus(error);
    if (status !== undefined && status >= 400 && status < 500) {
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

    logger.error(
      {
        err: error,
        threadId,
        agentId,
      },
      "Intelligence connect failed unexpectedly",
    );
    return Response.json(
      {
        error: "Connect request failed",
        message: "Intelligence platform connect failed unexpectedly",
        ...(error instanceof Error ? { details: error.message } : {}),
      },
      { status: 500 },
    );
  }
}
