import { logger } from "@copilotkit/shared";
import type {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
} from "../../core/runtime";
import { isIntelligenceRuntime } from "../../core/runtime";
import { PlatformRequestError } from "../../intelligence-platform/client";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";

interface AnnotateHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface AnnotateBody {
  /** Discriminator identifying the annotation type (e.g. `"user_action"`). */
  type: string;
  /** Type-specific payload. Shape varies by `type`. */
  payload?: unknown;
  /** The thread the annotation is associated with. */
  threadId: string;
  /** Caller-supplied idempotency key. Optional — platform auto-generates one when absent. */
  clientEventId?: string;
  /** ISO-8601 client-asserted timestamp. Defaults to server NOW() when absent. */
  occurredAt?: string;
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    logger.error({ err: error }, "Malformed JSON in annotate body");
    return errorResponse("Invalid request body", 400);
  }
}

function requireIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): CopilotIntelligenceRuntimeLike | Response {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(
      "Missing CopilotKitIntelligence configuration. annotate requires a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
      422,
    );
  }
  return runtime;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `POST /annotate` handler.
 *
 * Three-tier flow:
 *   recordAnnotation() (frontend lib; called by useLearnFromUserAction / useLearningContainers)
 *     → POST ${runtimeUrl}/annotate
 *     → this handler resolves the Intel user from BFF auth
 *     → intelligence.annotate(...)
 *     → PUT ${apiUrl}/connector/annotate/:clientEventId
 *
 * The frontend hook may auto-generate a UUID `clientEventId` per call
 * so retries are idempotent end-to-end (the platform collapses to the
 * original row).
 */
export async function handleAnnotate({
  runtime,
  request,
}: AnnotateHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) return intelligenceRuntime;

  const body = await parseJsonBody(request);
  if (isHandlerResponse(body)) return body;

  const user = await resolveIntelligenceUser({
    runtime: intelligenceRuntime,
    request,
  });
  if (isHandlerResponse(user)) return user;

  const parsed = parseAnnotateBody(body);
  if (isHandlerResponse(parsed)) return parsed;

  try {
    const result = await intelligenceRuntime.intelligence.annotate({
      userId: user.id,
      threadId: parsed.threadId,
      type: parsed.type,
      payload: parsed.payload,
      clientEventId: parsed.clientEventId,
      occurredAt: parsed.occurredAt,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error({ err }, "annotate: platform call failed");
    // Forward the platform's HTTP status when it's a client error
    // (4xx) so the SDK author sees an actionable response instead of
    // a generic 502. 5xx and non-platform errors collapse to 502
    // ("Bad Gateway") because the upstream is genuinely at fault.
    if (
      err instanceof PlatformRequestError &&
      err.status >= 400 &&
      err.status < 500
    ) {
      return errorResponse(err.message, err.status);
    }
    return errorResponse("Failed to annotate", 502);
  }
}

function parseAnnotateBody(
  body: Record<string, unknown>,
): AnnotateBody | Response {
  if (!isNonEmptyString(body.threadId)) {
    return errorResponse("Valid threadId is required", 400);
  }
  if (!isNonEmptyString(body.type)) {
    return errorResponse("Valid type is required", 400);
  }
  return {
    type: body.type,
    payload: body.payload,
    threadId: body.threadId,
    clientEventId: isNonEmptyString(body.clientEventId)
      ? body.clientEventId
      : undefined,
    occurredAt: isNonEmptyString(body.occurredAt) ? body.occurredAt : undefined,
  };
}
