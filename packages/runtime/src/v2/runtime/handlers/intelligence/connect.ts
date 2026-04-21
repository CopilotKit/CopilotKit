import { BaseEvent, EventType, RunStartedEvent } from "@ag-ui/client";
import { CopilotIntelligenceRuntimeLike } from "../../core/runtime";
import type {
  ConnectThreadBootstrapResponse,
  ConnectThreadLiveResponse,
} from "../../intelligence-platform/client";
import { isPlatformNotFoundError } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { isHandlerResponse } from "../shared/json-response";

interface HandleIntelligenceConnectParams {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
  threadId: string;
  runId: string;
  lastSeenEventId: string | null;
}

function stampCanonicalConnectEvent(
  event: BaseEvent,
  threadId: string,
  runId: string,
): BaseEvent {
  const { thread_id: _threadId, run_id: _runId, ...eventRecord } =
    event as BaseEvent & {
      thread_id?: unknown;
      run_id?: unknown;
    };

  if (event.type === EventType.RUN_STARTED) {
    const runStarted = eventRecord as RunStartedEvent;

    return {
      ...runStarted,
      threadId,
      runId,
      input: {
        ...(runStarted.input ?? {}),
        threadId,
        runId,
      },
    } as RunStartedEvent;
  }

  return {
    ...eventRecord,
    threadId,
    runId,
  } as BaseEvent;
}

function stampCanonicalConnectPlan(
  result: ConnectThreadBootstrapResponse | ConnectThreadLiveResponse,
  threadId: string,
  runId: string,
) {
  return {
    ...result,
    events: result.events.map((event) =>
      stampCanonicalConnectEvent(event, threadId, runId),
    ),
  };
}

export async function handleIntelligenceConnect({
  runtime,
  request,
  threadId,
  runId,
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
      runId,
      lastSeenEventId,
    });

    if (result === null) {
      return new Response(null, {
        status: 204,
      });
    }

    return Response.json(stampCanonicalConnectPlan(result, threadId, runId), {
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
