import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeUser,
} from "../../core/runtime";
import { errorResponse } from "./json-response";
import { isValidAppUserId } from "./intelligence-utils";

/** Why a candidate user was rejected, phrased to complete "identifyUser …". */
export interface IntelligenceUserValidationError {
  error: string;
}

/**
 * The shape gate every Intelligence user passes, however it was acquired
 * (OSS-643).
 *
 * HTTP runs acquire the user from `identifyUser(request)`; managed Channel turns
 * acquire it from the trusted delivery actor. Acquisition differs — validation
 * and everything downstream do not.
 *
 * Pure: no Request, no runtime, no I/O. That is what lets the Channel path reuse
 * it without fabricating an HTTP request, which is the trick this whole seam
 * exists to avoid.
 */
export function validateIntelligenceUser(
  user: unknown,
): CopilotRuntimeUser | IntelligenceUserValidationError {
  const candidate = user as CopilotRuntimeUser | undefined;
  if (!isValidAppUserId(candidate?.id)) {
    return { error: "must return a valid user id" };
  }
  if (
    typeof candidate?.name !== "string" ||
    candidate.name.trim().length === 0
  ) {
    return { error: "must return a valid user name" };
  }
  return { id: candidate.id, name: candidate.name };
}

/** True when {@link validateIntelligenceUser} rejected the candidate. */
export function isUserValidationError(
  result: CopilotRuntimeUser | IntelligenceUserValidationError,
): result is IntelligenceUserValidationError {
  return "error" in result;
}

/**
 * Resolve the user for an HTTP Intelligence request via the host's
 * `identifyUser(request)` callback.
 *
 * This remains the ONLY identity path for browser and API traffic. A runtime
 * that serves both HTTP and Channels keeps the two sources isolated because
 * neither shares state with the other — each turn carries its own user as an
 * argument.
 */
export async function resolveIntelligenceUser(params: {
  runtime: CopilotIntelligenceRuntimeLike;
  request: Request;
}): Promise<CopilotRuntimeUser | Response> {
  const { runtime, request } = params;

  // A Channel-only runtime legitimately has no `identifyUser` (OSS-643), but an
  // HTTP Intelligence request still needs an authenticated caller. Fail with an
  // actionable message rather than a TypeError on an undefined callback.
  if (typeof runtime.identifyUser !== "function") {
    return errorResponse(
      "This runtime serves HTTP Intelligence requests but has no `identifyUser`. " +
        "Channel-only runtimes may omit it; a runtime that also serves browser " +
        "or API users must authenticate those requests with `identifyUser(request)`.",
      500,
    );
  }

  try {
    const result = validateIntelligenceUser(await runtime.identifyUser(request));
    if (isUserValidationError(result)) {
      return errorResponse(`identifyUser ${result.error}`, 400);
    }
    return result;
  } catch (error) {
    console.error("Error identifying intelligence user:", error);
    return errorResponse("Failed to identify user", 500);
  }
}
