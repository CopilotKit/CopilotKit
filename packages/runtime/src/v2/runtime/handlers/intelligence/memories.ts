import type { CopilotRuntimeLike } from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";
import { PlatformRequestError } from "../../intelligence-platform/client";

interface MemoriesHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface MemoryMutationParams extends MemoriesHandlerParams {
  memoryId: string;
}

const MISSING_INTELLIGENCE_MESSAGE =
  "Missing CopilotKitIntelligence configuration. Memory operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.";

/** Allowed `kind` vocabulary the platform's memory endpoints accept. */
const MEMORY_KINDS: ReadonlySet<string> = new Set([
  "topical",
  "episodic",
  "operational",
]);
/** Allowed `scope` vocabulary the platform's memory endpoints accept. */
const MEMORY_SCOPES: ReadonlySet<string> = new Set(["user", "project"]);

/**
 * Maps a thrown error to a `Response`.
 *
 * For a {@link PlatformRequestError}, forward only client-actionable **4xx**
 * statuses verbatim (e.g. 404 missing/wrong-scope memory, 409 conflict, 422
 * unprocessable) so a `useMemories` consumer can branch on them — a flat 500
 * would erase that distinction. A platform **5xx** (or any non-4xx / malformed
 * status) means the runtime is healthy but its dependency failed, so it surfaces
 * as `502 Bad Gateway` rather than echoing the upstream status as if the runtime
 * itself broke — and this also avoids a `new Response(..., { status })`
 * `RangeError` on an out-of-range status. Non-platform throws stay 500.
 */
function memoryErrorResponse(error: unknown, message: string): Response {
  if (error instanceof PlatformRequestError) {
    const { status } = error;
    if (Number.isInteger(status) && status >= 400 && status <= 499) {
      return errorResponse(message, status);
    }
    return errorResponse(message, 502);
  }
  return errorResponse(message, 500);
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    logger.error({ err: error }, "Malformed JSON in memory request body");
    return errorResponse("Invalid request body", 400);
  }
}

/**
 * Extracts and validates the create/supersede body fields the platform's
 * memory endpoints require. Returns a `Response` (400) on invalid input.
 */
function parseMemoryBody(body: Record<string, unknown>):
  | {
      content: string;
      kind: string;
      scope?: string;
      sourceThreadIds?: string[];
    }
  | Response {
  const { content, kind, scope, sourceThreadIds } = body;
  if (typeof content !== "string" || typeof kind !== "string") {
    return errorResponse("Memory requires string `content` and `kind`", 400);
  }
  // `kind` must be one of the platform's known kinds. Reject an out-of-vocabulary
  // value here rather than forwarding it for the platform to reject.
  if (!MEMORY_KINDS.has(kind)) {
    return errorResponse(
      "Memory `kind` must be one of: topical, episodic, operational",
      400,
    );
  }
  // `scope` is optional: when omitted the platform applies its default
  // (`"user"`). Only reject a present-but-wrong-typed scope.
  if (scope !== undefined && typeof scope !== "string") {
    return errorResponse("Memory `scope` must be a string when provided", 400);
  }
  // When `scope` is present, it must be one of the known scopes.
  if (typeof scope === "string" && !MEMORY_SCOPES.has(scope)) {
    return errorResponse("Memory `scope` must be one of: user, project", 400);
  }
  // `sourceThreadIds` is optional, but when present it must be a string array.
  // Validate every element so non-string ids are not forwarded to the platform.
  if (
    sourceThreadIds !== undefined &&
    (!Array.isArray(sourceThreadIds) ||
      !sourceThreadIds.every((id) => typeof id === "string"))
  ) {
    return errorResponse(
      "Memory `sourceThreadIds` must be an array of strings when provided",
      400,
    );
  }
  return {
    content,
    kind,
    ...(typeof scope === "string" ? { scope } : {}),
    ...(Array.isArray(sourceThreadIds)
      ? { sourceThreadIds: sourceThreadIds as string[] }
      : {}),
    // `sourceThreadIds` elements are validated as strings above; the cast is safe.
  };
}

/**
 * Validates the recall body: `query` required non-empty string (trimmed);
 * `limit` optional finite positive integer; `scope` optional and in the known
 * scopes. Returns a 400 Response on invalid input. The returned `query` is the
 * trimmed value so a whitespace-padded query is never forwarded to the platform.
 */
function parseRecallBody(
  body: Record<string, unknown>,
): { query: string; limit?: number; scope?: string } | Response {
  const { query, limit, scope } = body;
  // Trim before the emptiness check so whitespace-only queries (e.g. "   ")
  // are rejected rather than forwarded as a useless query to the platform.
  const trimmedQuery = typeof query === "string" ? query.trim() : query;
  if (typeof trimmedQuery !== "string" || trimmedQuery.length === 0) {
    return errorResponse("Recall requires a non-empty string `query`", 400);
  }
  // When provided, `limit` must be a finite positive integer. `Number.isInteger`
  // already rejects NaN, Infinity, and fractions (NaN/Infinity would otherwise
  // JSON-serialize to `null` and silently corrupt the forwarded request);
  // the `> 0` guard rejects zero and negatives.
  if (
    limit !== undefined &&
    !(typeof limit === "number" && Number.isInteger(limit) && limit > 0)
  ) {
    return errorResponse("Recall `limit` must be a positive integer", 400);
  }
  if (scope !== undefined && typeof scope !== "string") {
    return errorResponse("Recall `scope` must be a string when provided", 400);
  }
  if (typeof scope === "string" && !MEMORY_SCOPES.has(scope)) {
    return errorResponse("Recall `scope` must be one of: user, project", 400);
  }
  return {
    query: trimmedQuery,
    ...(typeof limit === "number" ? { limit } : {}),
    ...(typeof scope === "string" ? { scope } : {}),
  };
}

/**
 * Lists the resolved user's long-term memories via the Intelligence platform.
 *
 * Mirrors {@link handleListThreads}: requires a `CopilotKitIntelligence`
 * runtime, resolves the user with `identifyUser` (never trusting a
 * client-supplied id), and proxies to the platform's `GET /api/memories`
 * with the project API key + resolved user. The `?includeInvalidated=true`
 * query is forwarded so callers can opt into retired rows. The response is
 * the platform's `{ memories }` envelope, which the client memory store
 * consumes directly.
 */
export async function handleListMemories({
  runtime,
  request,
}: MemoriesHandlerParams): Promise<Response> {
  if (isIntelligenceRuntime(runtime)) {
    try {
      const url = new URL(request.url);
      const includeInvalidated =
        url.searchParams.get("includeInvalidated") === "true";

      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const data = await runtime.intelligence.listMemories({
        userId: user.id,
        ...(includeInvalidated ? { includeInvalidated: true } : {}),
      });

      // The client memory store consumes the `{ memories: [...] }` envelope
      // directly. Assert the shape before forwarding so a platform contract
      // violation surfaces as a clear 502 (the runtime is healthy but its
      // dependency returned the wrong shape) instead of a 200 the client will
      // choke on.
      if (
        data == null ||
        typeof data !== "object" ||
        !Array.isArray((data as { memories?: unknown }).memories)
      ) {
        logger.error(
          { data },
          "listMemories: platform returned a response without a `memories` array",
        );
        return errorResponse(
          "Memory platform returned an invalid list response",
          502,
        );
      }

      return Response.json(data);
    } catch (error) {
      logger.error({ err: error }, "Error listing memories");
      return memoryErrorResponse(error, "Failed to list memories");
    }
  }

  return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
}

/**
 * Semantically recalls the resolved user's memories via the platform (`POST
 * /api/memories/recall`, hybrid RAG). Mirrors {@link handleListMemories}:
 * requires a `CopilotKitIntelligence` runtime, resolves the user with
 * `identifyUser` (never a client-supplied id), proxies with the project API
 * key + resolved user. Body `{ query, limit?, scope? }`; response `{ memories }`,
 * each optionally carrying `score`.
 */
export async function handleRecallMemories({
  runtime,
  request,
}: MemoriesHandlerParams): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
  }
  try {
    const body = await parseJsonBody(request);
    if (isHandlerResponse(body)) return body;
    const fields = parseRecallBody(body);
    if (isHandlerResponse(fields)) return fields;

    const user = await resolveIntelligenceUser({ runtime, request });
    if (isHandlerResponse(user)) return user;

    const data = await runtime.intelligence.recallMemories({
      userId: user.id,
      ...fields,
    });

    if (
      data == null ||
      typeof data !== "object" ||
      !Array.isArray((data as { memories?: unknown }).memories)
    ) {
      logger.error(
        { data },
        "recallMemories: platform returned a response without a `memories` array",
      );
      return errorResponse(
        "Memory platform returned an invalid recall response",
        502,
      );
    }
    return Response.json(data);
  } catch (error) {
    logger.error({ err: error }, "Error recalling memories");
    return memoryErrorResponse(error, "Failed to recall memories");
  }
}

/**
 * Mints memory-realtime join credentials (platform `POST
 * /api/memories/subscribe`). Mirrors {@link handleSubscribeToThreads}: requires
 * a `CopilotKitIntelligence` runtime and resolves the user with `identifyUser`
 * (never a client-supplied id). Returns `{ joinToken, joinCode }` — memory needs
 * the `joinCode` here (unlike threads, where it rides the thread-list response)
 * because the client builds the `user_meta:memories:<joinCode>` channel topic
 * from it.
 *
 * When the platform also resolves a project scope, the response additionally
 * carries `projectJoinToken` / `projectJoinCode`, which the client uses to open
 * a second `project_meta:memories:<projectJoinCode>` channel. These are
 * optional: absent project scope → both fields are omitted (silent-degrade
 * contract; the client opens only the user channel).
 */
export async function handleSubscribeToMemories({
  runtime,
  request,
}: MemoriesHandlerParams): Promise<Response> {
  if (isIntelligenceRuntime(runtime)) {
    try {
      const user = await resolveIntelligenceUser({ runtime, request });
      if (isHandlerResponse(user)) return user;

      const credentials = await runtime.intelligence.ɵsubscribeToMemories({
        userId: user.id,
      });

      return Response.json({
        joinToken: credentials.joinToken,
        joinCode: credentials.joinCode,
        // Project-scoped credentials ride along only when the platform minted
        // them; omit both when absent (silent-degrade contract).
        ...(credentials.projectJoinToken !== undefined
          ? { projectJoinToken: credentials.projectJoinToken }
          : {}),
        ...(credentials.projectJoinCode !== undefined
          ? { projectJoinCode: credentials.projectJoinCode }
          : {}),
      });
    } catch (error) {
      logger.error({ err: error }, "Error subscribing to memories");
      return memoryErrorResponse(error, "Failed to subscribe to memories");
    }
  }

  return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
}

/**
 * Creates a memory for the resolved user (platform `POST /api/memories`).
 * Identity comes from `identifyUser`, never the request body. Returns 201
 * with the stored memory (the client store applies it server-authoritatively).
 */
export async function handleCreateMemory({
  runtime,
  request,
}: MemoriesHandlerParams): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
  }
  try {
    const body = await parseJsonBody(request);
    if (isHandlerResponse(body)) return body;
    const fields = parseMemoryBody(body);
    if (isHandlerResponse(fields)) return fields;

    const user = await resolveIntelligenceUser({ runtime, request });
    if (isHandlerResponse(user)) return user;

    const data = await runtime.intelligence.createMemory({
      userId: user.id,
      ...fields,
    });
    return Response.json(data, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, "Error creating memory");
    return memoryErrorResponse(error, "Failed to create memory");
  }
}

/**
 * Supersedes a memory (platform `PATCH /api/memories/:id`): retires `:id` and
 * inserts the new content atomically; the response carries `retiredId`.
 */
export async function handleUpdateMemory({
  runtime,
  request,
  memoryId,
}: MemoryMutationParams): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
  }
  try {
    const body = await parseJsonBody(request);
    if (isHandlerResponse(body)) return body;
    const fields = parseMemoryBody(body);
    if (isHandlerResponse(fields)) return fields;

    const user = await resolveIntelligenceUser({ runtime, request });
    if (isHandlerResponse(user)) return user;

    const data = await runtime.intelligence.updateMemory({
      userId: user.id,
      id: memoryId,
      ...fields,
    });
    return Response.json(data);
  } catch (error) {
    logger.error({ err: error }, "Error updating memory");
    return memoryErrorResponse(error, "Failed to update memory");
  }
}

/**
 * Retires (forgets) a memory (platform `DELETE /api/memories/:id`). Non-lossy
 * on the platform side; returns 204.
 */
export async function handleRemoveMemory({
  runtime,
  request,
  memoryId,
}: MemoryMutationParams): Promise<Response> {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(MISSING_INTELLIGENCE_MESSAGE, 422);
  }
  try {
    const user = await resolveIntelligenceUser({ runtime, request });
    if (isHandlerResponse(user)) return user;

    await runtime.intelligence.removeMemory({ userId: user.id, id: memoryId });
    return new Response(null, { status: 204 });
  } catch (error) {
    logger.error({ err: error }, "Error removing memory");
    return memoryErrorResponse(error, "Failed to remove memory");
  }
}
