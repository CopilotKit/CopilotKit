import type { CopilotRuntimeLike } from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { logger } from "@copilotkit/shared";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";

interface MemoriesHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
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

  return errorResponse(
    "Missing CopilotKitIntelligence configuration. Memory operations require a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
    422,
  );
}
