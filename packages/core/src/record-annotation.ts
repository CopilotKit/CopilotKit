import { randomUUID } from "@copilotkit/shared";

/** Result returned by the CopilotKit runtime annotation endpoint. */
export interface RecordAnnotationResult {
  /** Platform-assigned annotation ID. */
  id: string;
  /** Whether the platform had already recorded this client event ID. */
  duplicate: boolean;
}

/** Framework-neutral inputs for recording an annotation. */
export interface RecordAnnotationArgs {
  /** Base URL of the CopilotKit runtime. */
  runtimeUrl: string;
  /** Additional headers forwarded to the runtime. */
  headers: Readonly<Record<string, string>>;
  /** Fetch credentials mode. When omitted, Fetch uses its default behavior. */
  credentials?: RequestCredentials;
  /** Annotation discriminator understood by the runtime. */
  type: string;
  /** Optional type-specific, JSON-serializable value. */
  payload?: unknown;
  /** Thread associated with the annotation. */
  threadId: string;
  /**
   * Idempotency key for the semantic event. A fresh UUID is generated for each
   * call when omitted. Reuse an explicit ID when retrying the same event.
   */
  clientEventId?: string;
  /** Optional ISO-8601 client-asserted timestamp. */
  occurredAt?: string;
}

/** Framework-neutral input describing a user action. */
export interface UserActionInput {
  /** Thread associated with the action. */
  threadId: string;
  /** Optional short summary of the action. */
  title?: string | null;
  /** Optional longer explanation of the action. */
  description?: string | null;
  /** Optional JSON-serializable action data. */
  data?: unknown;
  /** Optional ISO-8601 client-asserted timestamp. */
  occurredAt?: string;
  /**
   * Idempotency key for the semantic event. A fresh UUID is generated for each
   * call when omitted. Reuse an explicit ID when retrying the same event.
   */
  clientEventId?: string;
}

/** Inputs for recording a user action through the CopilotKit runtime. */
export type RecordUserActionArgs = UserActionInput &
  Pick<RecordAnnotationArgs, "runtimeUrl" | "headers" | "credentials">;

/** Record an annotation through the customer's CopilotKit runtime. */
export async function recordAnnotation(
  args: RecordAnnotationArgs,
): Promise<RecordAnnotationResult> {
  const clientEventId = args.clientEventId ?? randomUUID();
  const response = await fetch(`${args.runtimeUrl}/annotate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...args.headers,
    },
    ...(args.credentials === undefined
      ? {}
      : { credentials: args.credentials }),
    body: JSON.stringify({
      type: args.type,
      ...(args.payload === undefined ? {} : { payload: args.payload }),
      threadId: args.threadId,
      clientEventId,
      ...(args.occurredAt === undefined ? {} : { occurredAt: args.occurredAt }),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `recordAnnotation: request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const body = await response.text();
  if (!body) {
    throw new Error(
      `recordAnnotation: runtime ${args.runtimeUrl}/annotate returned ${response.status} with an empty body`,
    );
  }

  try {
    return JSON.parse(body) as RecordAnnotationResult;
  } catch {
    throw new Error(
      `recordAnnotation: runtime ${args.runtimeUrl}/annotate returned a non-JSON body (status ${response.status})`,
    );
  }
}

/** Record a user action through the customer's CopilotKit runtime. */
export function recordUserAction(
  args: RecordUserActionArgs,
): Promise<RecordAnnotationResult> {
  const { title, description, data, ...annotationArgs } = args;
  const payload =
    title === undefined && description === undefined && data === undefined
      ? undefined
      : { title, description, data };

  return recordAnnotation({
    ...annotationArgs,
    type: "user_action",
    payload,
  });
}
