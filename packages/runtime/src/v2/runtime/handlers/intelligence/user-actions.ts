import { logger } from "@copilotkit/shared";
import {
  CopilotIntelligenceRuntimeLike,
  CopilotRuntimeLike,
  isIntelligenceRuntime,
} from "../../core/runtime";
import { PlatformRequestError } from "../../intelligence-platform/client";
import { errorResponse, isHandlerResponse } from "../shared/json-response";
import { resolveIntelligenceUser } from "../shared/resolve-intelligence-user";

interface UserActionsHandlerParams {
  runtime: CopilotRuntimeLike;
  request: Request;
}

interface RecordUserActionBody {
  threadId: string;
  title?: string | null;
  description?: string | null;
  previousData?: unknown;
  newData?: unknown;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string;
  clientEventId: string;
}

async function parseJsonBody(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch (error) {
    logger.error({ err: error }, "Malformed JSON in record-user-action body");
    return errorResponse("Invalid request body", 400);
  }
}

function requireIntelligenceRuntime(
  runtime: CopilotRuntimeLike,
): CopilotIntelligenceRuntimeLike | Response {
  if (!isIntelligenceRuntime(runtime)) {
    return errorResponse(
      "Missing CopilotKitIntelligence configuration. recordUserAction requires a CopilotKitIntelligence instance to be provided in CopilotRuntime options.",
      422,
    );
  }
  return runtime;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * `POST /user-actions` handler.
 *
 * Three-tier flow:
 *   useRecordUserAction() (frontend)
 *     → POST ${runtimeUrl}/user-actions
 *     → this handler resolves the Intel user from BFF auth
 *     → intelligence.recordUserAction(...)
 *     → PUT ${apiUrl}/connector/user-actions/record/:clientEventId
 *
 * The frontend hook auto-generates a UUID `clientEventId` per call,
 * so retries are idempotent end-to-end (the platform collapses to the
 * original row).
 */
export async function handleRecordUserAction({
  runtime,
  request,
}: UserActionsHandlerParams): Promise<Response> {
  const intelligenceRuntime = requireIntelligenceRuntime(runtime);
  if (isHandlerResponse(intelligenceRuntime)) return intelligenceRuntime;

  const body = await parseJsonBody(request);
  if (isHandlerResponse(body)) return body;

  const user = await resolveIntelligenceUser({
    runtime: intelligenceRuntime,
    request,
  });
  if (isHandlerResponse(user)) return user;

  const parsed = parseRecordUserActionBody(body);
  if (isHandlerResponse(parsed)) return parsed;

  try {
    const result = await intelligenceRuntime.intelligence.recordUserAction({
      userId: user.id,
      threadId: parsed.threadId,
      title: parsed.title,
      description: parsed.description,
      previousData: parsed.previousData,
      newData: parsed.newData,
      metadata: parsed.metadata,
      occurredAt: parsed.occurredAt,
      clientEventId: parsed.clientEventId,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logger.error({ err }, "recordUserAction: platform call failed");
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
    return errorResponse("Failed to record user action", 502);
  }
}

function parseRecordUserActionBody(
  body: Record<string, unknown>,
): RecordUserActionBody | Response {
  if (!isNonEmptyString(body.threadId)) {
    return errorResponse("Valid threadId is required", 400);
  }
  if (!isNonEmptyString(body.clientEventId)) {
    return errorResponse("Valid clientEventId is required", 400);
  }
  return {
    threadId: body.threadId,
    title:
      body.title === undefined
        ? undefined
        : body.title === null
          ? null
          : isNonEmptyString(body.title)
            ? body.title
            : undefined,
    description:
      body.description === undefined
        ? undefined
        : body.description === null
          ? null
          : isNonEmptyString(body.description)
            ? body.description
            : undefined,
    previousData: body.previousData,
    newData: body.newData,
    metadata:
      body.metadata === undefined
        ? undefined
        : body.metadata === null
          ? null
          : typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? (body.metadata as Record<string, unknown>)
            : undefined,
    occurredAt: isNonEmptyString(body.occurredAt) ? body.occurredAt : undefined,
    clientEventId: body.clientEventId,
  };
}
