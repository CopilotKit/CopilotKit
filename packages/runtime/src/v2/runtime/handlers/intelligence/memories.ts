import type { CopilotRuntimeLike } from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";

interface MemoriesHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface MemoryMutationParams extends MemoriesHandlerParams {
  memoryId: string;
}

const MISSING_INTELLIGENCE_MESSAGE =
  "Missing CopilotKitIntelligence configuration. Memory operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.";

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
function parseMemoryBody(
  body: Record<string, unknown>,
):
  | { content: string; kind: string; scope: string; sourceThreadIds?: string[] }
  | Response {
  const { content, kind, scope, sourceThreadIds } = body;
  if (
    typeof content !== "string" ||
    typeof kind !== "string" ||
    typeof scope !== "string"
  ) {
    return errorResponse(
      "Memory requires string `content`, `kind`, and `scope`",
      400,
    );
  }
  return {
    content,
    kind,
    scope,
    ...(Array.isArray(sourceThreadIds)
      ? { sourceThreadIds: sourceThreadIds as string[] }
      : {}),
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

      return Response.json(data);
    } catch (error) {
      logger.error({ err: error }, "Error listing memories");
      return errorResponse("Failed to list memories", 500);
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
    return errorResponse("Failed to create memory", 500);
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
    return errorResponse("Failed to update memory", 500);
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
    return errorResponse("Failed to remove memory", 500);
  }
}
