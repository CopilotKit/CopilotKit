import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
} from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { isValidIdentifier } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { supportsLocalThreadEndpoints } from "../../runner/agent-runner";
import { PlatformRequestError } from "../../intelligence-platform/client";

interface ThreadsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface ThreadMutationParams extends ThreadsHandlerParams {
  threadId: string;
}

interface ThreadMutationContext {
  userId: string;
  agentId: string;
  body: Record<string, unknown>;
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    logger.error({ err: error }, "Malformed JSON in request body");
    return errorResponse("Invalid request body", 400);
  }
}

function requireIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): CopilotIntelligenceRuntimeLike | Response {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(
      "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
      422,
    );
  }

  return runtime;
}

async function resolveThreadMutationContext(
  runtime: CopilotIntelligenceRuntimeLike,
  request: Request,
): Promise<ThreadMutationContext | Response> {
  const body = await parseJsonBody(request);
  if (isHandlerResponse(body)) return body;

  const user = await resolveIntelligenceUser({ runtime, request });
  if (isHandlerResponse(user)) return user;

  const agentId = body.agentId;
  if (!isValidIdentifier(agentId)) {
    return errorResponse("Valid agentId is required", 400);
  }

  return {
    body,
    userId: user.id,
    agentId,
  };
}

export async function handleListThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  // CopilotKit Intelligence path
  if (isIntelligenceRuntime(runtime)) {
    try {
      const url = new URL(request.url);
      const agentId = url.searchParams.get("agentId");
      const includeArchived =
        url.searchParams.get("includeArchived") === "true";
      const limitParam = url.searchParams.get("limit");
      const cursor = url.searchParams.get("cursor");
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      if (!isValidIdentifier(agentId)) {
        return errorResponse("Valid agentId query param is required", 400);
      }

      const data = await runtime.intelligence.listThreads({
        userId: user.id,
        agentId,
        ...(includeArchived ? { includeArchived: true } : {}),
        ...(limitParam ? { limit: Number(limitParam) } : {}),
        ...(cursor ? { cursor } : {}),
      });

      return Response.json(data);
    } catch (error) {
      logger.error({ err: error }, "Error listing threads");
      return errorResponse("Failed to list threads", 500);
    }
  }

  // Local in-memory fallback — useful for local development without Intelligence
  if (supportsLocalThreadEndpoints(runtime.runner)) {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId");
    let threads = runtime.runner.listThreads();
    if (agentId) {
      threads = threads.filter((t) => t.agentId === agentId);
    }
    return Response.json({ threads, nextCursor: null });
  }

  return errorResponse(
    "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    422,
  );
}

/**
 * Clears all in-memory thread history for the local-dev InMemory fallback.
 *
 * The local-dev fallback exposes this so consumers (e.g. the demo's Clear
 * button) can wipe in-memory thread history without restarting the runtime.
 * Intentionally a no-op when CopilotKit Intelligence is configured: real
 * thread history lives in the database and must not be wiped by a
 * client-side page load.
 */
export function handleClearThreads({
  runtime,
}: ThreadsHandlerParams): Response {
  if (supportsLocalThreadEndpoints(runtime.runner)) {
    runtime.runner.clearThreads();
  }
  return new Response(null, { status: 204 });
}

export async function handleUpdateThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    const updates = { ...mutation.body };
    delete updates.agentId;
    delete updates.userId;

    const thread = await intelligenceRuntime.intelligence.updateThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
      updates,
    });

    return Response.json(thread);
  } catch (error) {
    logger.error({ err: error, threadId }, "Error updating thread");
    return errorResponse("Failed to update thread", 500);
  }
}

export async function handleSubscribeToThreads({
  runtime,
  request,
}: ThreadsHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const user = await resolveIntelligenceUser({
      runtime: intelligenceRuntime,
      request,
    });
    if (isHandlerResponse(user)) return user;

    const credentials =
      await intelligenceRuntime.intelligence.ɵsubscribeToThreads({
        userId: user.id,
      });

    return Response.json({ joinToken: credentials.joinToken });
  } catch (error) {
    logger.error({ err: error }, "Error subscribing to threads");
    return errorResponse("Failed to subscribe to threads", 500);
  }
}

export async function handleArchiveThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    await intelligenceRuntime.intelligence.archiveThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
    });

    return Response.json({ threadId, archived: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error archiving thread");
    return errorResponse("Failed to archive thread", 500);
  }
}

export async function handleDeleteThread({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) {
    return intelligenceRuntime;
  }

  try {
    const mutation = await resolveThreadMutationContext(
      intelligenceRuntime,
      request,
    );
    if (isHandlerResponse(mutation)) return mutation;

    await intelligenceRuntime.intelligence.deleteThread({
      threadId,
      userId: mutation.userId,
      agentId: mutation.agentId,
    });

    return Response.json({ threadId, deleted: true });
  } catch (error) {
    logger.error({ err: error, threadId }, "Error deleting thread");
    return errorResponse("Failed to delete thread", 500);
  }
}

/**
 * True when the platform said the thread is not there FOR THIS CALLER.
 *
 * Matched on the platform's code, never on the 404 status: at least sixteen
 * conditions map to 404, several of them misconfiguration (`ORG_NOT_FOUND`,
 * `API_KEY_NOT_FOUND`, `ROUTE_NOT_FOUND` for a platform too old to serve the
 * path). Reading those as "absent" turns a broken deployment into an
 * convincingly empty one. Unknown stays unknown, and unknown stays loud.
 */
function isThreadNotFound(error: unknown): boolean {
  return (
    error instanceof PlatformRequestError && error.code === "THREAD_NOT_FOUND"
  );
}

/**
 * Resolve a thread through the USER-scoped route, to answer "may this caller
 * see this thread at all?".
 *
 * The `_inspect` routes behind events and state are scoped by organization and
 * project, NOT by app user — so on their own they will hand any caller who
 * knows a thread id the raw event stream of a DIFFERENT app user in the same
 * project, message text and tool payloads included. The user-scoped route does
 * enforce ownership (`assertThreadUserOwnership`) and reports a thread that is
 * missing and one that belongs to someone else with the same
 * `THREAD_NOT_FOUND`, which is the pair we want: both mean "nothing here for
 * you".
 *
 * Returns false when the caller may not see it, true when they may. Anything
 * else throws, so a platform failure never reads as a denial.
 */
async function callerMaySeeThread(
  runtime: { intelligence: { getThread: (p: { threadId: string; userId: string }) => Promise<unknown> } },
  threadId: string,
  userId: string,
): Promise<boolean> {
  try {
    await runtime.intelligence.getThread({ threadId, userId });
    return true;
  } catch (error) {
    if (isThreadNotFound(error)) return false;
    throw error;
  }
}

export async function handleGetThreadMessages({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  // CopilotKit Intelligence path
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const data = await runtime.intelligence.getThreadMessages({
        threadId,
        userId: user.id,
      });
      return Response.json(data);
    } catch (error) {
      // Same reasoning as events: the inspector follows an empty event list
      // with a messages fetch for the SAME unseen thread, so leaving this one
      // at 500 just moves the red request one call down the same page load.
      if (isThreadNotFound(error)) return Response.json({ messages: [] });
      logger.error({ err: error, threadId }, "Error fetching thread messages");
      return errorResponse("Failed to fetch thread messages", 500);
    }
  }

  // Local in-memory fallback — useful for local development without Intelligence
  if (supportsLocalThreadEndpoints(runtime.runner)) {
    const messages = runtime.runner.getThreadMessages(threadId);
    // Map ag-ui Message objects to the same shape CopilotKit Intelligence
    // returns. Switching on the discriminant `role` lets each branch read
    // the narrowed message arm directly, instead of laundering through
    // `Record<string, unknown>` and chained `as` casts.
    const mapped = messages.map((msg) => {
      switch (msg.role) {
        case "assistant": {
          const toolCalls = msg.toolCalls ?? [];
          return {
            id: msg.id,
            role: msg.role,
            ...(msg.content !== undefined ? { content: msg.content } : {}),
            ...(toolCalls.length > 0
              ? {
                  toolCalls: toolCalls.map((tc) => ({
                    id: tc.id,
                    name: tc.function.name,
                    args: tc.function.arguments,
                  })),
                }
              : {}),
          };
        }
        case "tool":
          return {
            id: msg.id,
            role: msg.role,
            content: msg.content,
            toolCallId: msg.toolCallId,
          };
        default:
          return {
            id: msg.id,
            role: msg.role,
            ...("content" in msg && msg.content !== undefined
              ? { content: msg.content }
              : {}),
          };
      }
    });
    return Response.json({ messages: mapped });
  }

  return errorResponse(
    "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    422,
  );
}

export async function handleGetThreadEvents({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  // CopilotKit Intelligence path. Delegates to the platform's `_inspect`
  // endpoint (Intelligence PR #144). Auth still flows through the standard
  // identifyUser → API key path; threadId scoping happens server-side.
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      // OWNERSHIP GATE. `_inspect` is org/project scoped, not app-user scoped,
      // so it must not be reached until the user-scoped route has confirmed
      // this caller owns the thread. A thread that is missing and one that
      // belongs to another app user both answer empty here.
      if (!(await callerMaySeeThread(runtime, threadId, user.id))) {
        return Response.json({ events: [] });
      }

      const data = await runtime.intelligence.getThreadEvents({ threadId });
      // Strip platform-internal fields (`decodeErrorRowIds`, `truncated`)
      // before returning to the inspector — those describe persistence-side
      // concerns the inspector currently has no UI for. The shape becomes
      // `{ events }`, matching the in-memory branch below.
      return Response.json({ events: data.events });
    } catch (error) {
      // Belt and braces behind the ownership gate above: if the platform
      // reports the thread away between the two calls, that is still "nothing
      // here", not a server fault.
      if (isThreadNotFound(error)) return Response.json({ events: [] });
      logger.error({ err: error, threadId }, "Error fetching thread events");
      return errorResponse("Failed to fetch thread events", 500);
    }
  }

  // Local in-memory fallback
  if (supportsLocalThreadEndpoints(runtime.runner)) {
    try {
      const events = runtime.runner.getThreadEvents(threadId);
      return Response.json({ events });
    } catch (error) {
      logger.error({ err: error, threadId }, "Error fetching thread events");
      return errorResponse("Failed to fetch thread events", 500);
    }
  }

  return errorResponse(
    "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    422,
  );
}

export async function handleGetThreadState({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  // CopilotKit Intelligence path. Delegates to the platform's `_inspect`
  // state endpoint, which folds STATE_DELTA events onto the latest
  // STATE_SNAPSHOT to return the thread's current state.
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      // Same ownership gate as events, and for the same reason: the state
      // route is `_inspect` too, so it is org/project scoped rather than
      // app-user scoped.
      if (!(await callerMaySeeThread(runtime, threadId, user.id))) {
        return Response.json({ state: null });
      }

      const data = await runtime.intelligence.getThreadState({ threadId });
      // Flatten the discriminated `ThreadStateResult` to the wire shape the
      // inspector consumes (`{ state: <value> | null }`). Missing snapshot
      // and decode-error both surface as `null`; the inspector renders an
      // empty state branch for null and the platform's decode-error case is
      // already logged platform-side.
      const state = data.kind === "snapshot" ? data.state : null;
      return Response.json({ state });
    } catch (error) {
      if (isThreadNotFound(error)) return Response.json({ state: null });
      logger.error({ err: error, threadId }, "Error fetching thread state");
      return errorResponse("Failed to fetch thread state", 500);
    }
  }

  if (supportsLocalThreadEndpoints(runtime.runner)) {
    try {
      const state = runtime.runner.getThreadState(threadId);
      return Response.json({ state });
    } catch (error) {
      logger.error({ err: error, threadId }, "Error fetching thread state");
      return errorResponse("Failed to fetch thread state", 500);
    }
  }

  return errorResponse(
    "Missing CopilotKitIntelligence configuration. Thread operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    422,
  );
}
