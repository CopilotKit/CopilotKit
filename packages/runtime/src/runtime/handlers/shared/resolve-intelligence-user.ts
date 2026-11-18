import type {
  CopilotKitIntelligenceRuntimeLike,
  CopilotKitRuntimeLike,
  CopilotKitRuntimeUser,
  IdentifyUserCallback,
} from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { getRuntimeLogger } from "../../core/logger";
import { errorResponse } from "./json-response";
import { isValidIdentifier } from "./intelligence-utils";

/** A runtime whose `identifyUser` is known to be set. */
export type IdentifiedRuntimeLike = CopilotKitRuntimeLike & {
  identifyUser: IdentifyUserCallback;
};

/** Narrows a runtime to one that has `identifyUser`. */
export function hasIdentifyUser(
  runtime: CopilotKitRuntimeLike,
): runtime is IdentifiedRuntimeLike {
  return typeof runtime.identifyUser === "function";
}

const resolvedUsers = new WeakMap<
  Request,
  Promise<CopilotKitRuntimeUser | Response>
>();

/**
 * Resolves the request's user through `identifyUser`, once per request, for
 * both runtime kinds: the Intelligence runtime and an SSE runtime with
 * `identifyUser` (local Thread ownership). Only the Intelligence runtime
 * needs the user's `name`; an SSE runtime needs the `id` alone.
 *
 * A callback that throws gets a 500 on every route.
 */
export async function resolveIntelligenceUser(params: {
  runtime: CopilotKitIntelligenceRuntimeLike | IdentifiedRuntimeLike;
  request: Request;
}): Promise<CopilotKitRuntimeUser | Response> {
  const { runtime, request } = params;

  const existing = resolvedUsers.get(request);
  if (existing !== undefined) return existing;

  const resolution = resolveUser(runtime, request);
  resolvedUsers.set(request, resolution);
  return resolution;
}

async function resolveUser(
  runtime: CopilotKitRuntimeLike,
  request: Request,
): Promise<CopilotKitRuntimeUser | Response> {
  if (!hasIdentifyUser(runtime)) {
    getRuntimeLogger(runtime).error(
      "Error identifying user: identifyUser is not configured",
    );
    return errorResponse("Failed to identify user", 500);
  }
  try {
    const user = await runtime.identifyUser(request);
    if (!isValidIdentifier(user?.id)) {
      return errorResponse("identifyUser must return a valid user id", 400);
    }
    const hasName =
      typeof user?.name === "string" && user.name.trim().length > 0;
    if (!hasName && isIntelligenceRuntime(runtime)) {
      return errorResponse("identifyUser must return a valid user name", 400);
    }

    return { id: user.id, name: hasName ? user.name : user.id };
  } catch (error) {
    getRuntimeLogger(runtime).error({ err: error }, "Error identifying user");
    return errorResponse("Failed to identify user", 500);
  }
}
