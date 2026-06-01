import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
  isIntelligenceRuntime,
} from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { isValidIdentifier } from "../shared/intelligence-utils";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { InMemoryAgentRunner } from "../../runner/in-memory";

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
  // Intelligence platform path
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
  if (runtime.runner instanceof InMemoryAgentRunner) {
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
 * Intentionally a no-op when the Intelligence platform is configured: real
 * thread history lives in the database and must not be wiped by a
 * client-side page load.
 */
export function handleClearThreads({
  runtime,
}: ThreadsHandlerParams): Response {
  if (runtime.runner instanceof InMemoryAgentRunner) {
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

export async function handleGetThreadMessages({
  runtime,
  request,
  threadId,
}: ThreadMutationParams): Promise<Response> {
  // Intelligence platform path
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const data = await runtime.intelligence.getThreadMessages({ threadId });
      return Response.json(data);
    } catch (error) {
      logger.error({ err: error, threadId }, "Error fetching thread messages");
      return errorResponse("Failed to fetch thread messages", 500);
    }
  }

  // Local in-memory fallback — useful for local development without Intelligence
  if (runtime.runner instanceof InMemoryAgentRunner) {
    const messages = runtime.runner.getThreadMessages(threadId);
    // Map ag-ui Message objects to the same shape the Intelligence platform
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
  // Intelligence platform path. Delegates to the platform's `_inspect`
  // endpoint (Intelligence PR #144). Auth still flows through the standard
  // identifyUser → API key path; threadId scoping happens server-side.
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const data = await runtime.intelligence.getThreadEvents({ threadId });
      // Strip platform-internal fields (`decodeErrorRowIds`, `truncated`)
      // before returning to the inspector — those describe persistence-side
      // concerns the inspector currently has no UI for. The shape becomes
      // `{ events }`, matching the in-memory branch below.
      return Response.json({ events: data.events });
    } catch (error) {
      logger.error({ err: error, threadId }, "Error fetching thread events");
      return errorResponse("Failed to fetch thread events", 500);
    }
  }

  // Local in-memory fallback
  if (runtime.runner instanceof InMemoryAgentRunner) {
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
  // Intelligence platform path. Delegates to the platform's `_inspect`
  // state endpoint, which folds STATE_DELTA events onto the latest
  // STATE_SNAPSHOT to return the thread's current state.
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const data = await runtime.intelligence.getThreadState({ threadId });
      // Flatten the discriminated `ThreadStateResult` to the wire shape the
      // inspector consumes (`{ state: <value> | null }`). Missing snapshot
      // and decode-error both surface as `null`; the inspector renders an
      // empty state branch for null and the platform's decode-error case is
      // already logged platform-side.
      const state = data.kind === "snapshot" ? data.state : null;
      return Response.json({ state });
    } catch (error) {
      logger.error({ err: error, threadId }, "Error fetching thread state");
      return errorResponse("Failed to fetch thread state", 500);
    }
  }

  if (runtime.runner instanceof InMemoryAgentRunner) {
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
