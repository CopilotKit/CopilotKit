import { randomUUID } from "@copilotkit/shared";

/**
 * The result shape returned by the CopilotKit runtime `/annotate` endpoint.
 */
export interface RecordAnnotationResult {
  /** Platform-assigned id of the annotation row. */
  id: string;
  /** `true` when the platform recognized this `clientEventId` as a retry. */
  duplicate: boolean;
}

/**
 * Arguments for {@link recordAnnotation}.
 *
 * The transport dependencies (`runtimeUrl`, `headers`) mirror what the
 * `useLearnFromUserAction` hook reads from `copilotkit` context, so the hook
 * can pass them through without any structural change.
 *
 * `userId` is intentionally absent — the runtime resolves the user from BFF
 * auth server-side and the browser must never send it.
 */
export interface RecordAnnotationArgs {
  /**
   * Base URL of the customer's CopilotKit runtime
   * (e.g. `https://bff.example.com/api/copilotkit`).
   * The function appends `/annotate`.
   */
  runtimeUrl: string;
  /**
   * Extra HTTP headers forwarded from `copilotkit.headers` — typically used
   * for customer auth tokens that the BFF needs to identify the user.
   */
  headers: Record<string, string>;
  /**
   * The annotation discriminant understood by the Intelligence platform.
   * Known values: `"user_action"`, `"set_learning_containers"`.
   */
  type: string;
  /**
   * Free-form, JSON-serializable payload whose shape depends on `type`.
   * Omit (or pass `undefined`) for annotation types with no payload body.
   */
  payload?: unknown;
  /** Thread the annotation is associated with. */
  threadId: string;
  /**
   * Caller-supplied idempotency key. When omitted, a UUID is generated so
   * every call is naturally safe against platform-level duplicate processing.
   * Supply your own key when the same semantic event must stay idempotent
   * across multiple calls (e.g. a retry button or a React strict-mode
   * double-mount).
   */
  clientEventId?: string;
  /**
   * ISO-8601 client-asserted timestamp.
   * Defaults to server `NOW()` when absent.
   */
  occurredAt?: string;
}

/**
 * Low-level function that posts an arbitrary annotation to the CopilotKit
 * runtime's general annotation endpoint (`POST /annotate`).
 *
 * This is the single transport entry point for all annotation types. Higher-
 * level hooks (e.g. `useLearnFromUserAction`) build the `type`/`payload` pair
 * for their specific annotation shape and delegate the HTTP call here.
 *
 * The function uses the same transport as `useLearnFromUserAction`:
 * - `runtimeUrl` from `copilotkit.runtimeUrl` (BFF proxies to the platform)
 * - `headers` from `copilotkit.headers` (customer auth forwarded to BFF)
 * - `clientEventId` auto-generated via `randomUUID()` when omitted
 * - `userId` is resolved server-side by the runtime; the client never sends it
 * - Errors propagate to the caller (fire-and-propagate, not fire-and-forget)
 *
 * @param args - Transport dependencies plus annotation fields.
 * @returns The platform result containing the annotation row `id` and a
 *          `duplicate` flag.
 * @throws When the network request fails or the runtime returns a non-2xx
 *         status. Callers that want fire-and-forget behavior should `.catch`
 *         at the call site.
 */
export async function recordAnnotation(
  args: RecordAnnotationArgs,
): Promise<RecordAnnotationResult> {
  const { runtimeUrl, headers, type, payload, threadId, occurredAt } = args;

  const clientEventId = args.clientEventId ?? randomUUID();

  const body: Record<string, unknown> = {
    type,
    threadId,
    clientEventId,
    ...(payload !== undefined ? { payload } : {}),
    ...(occurredAt !== undefined ? { occurredAt } : {}),
  };

  const response = await fetch(`${runtimeUrl}/annotate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `recordAnnotation: request failed (${response.status})${text ? `: ${text}` : ""}`,
    );
  }

  const text = await response.text();
  if (!text) {
    throw new Error(
      `recordAnnotation: runtime ${runtimeUrl}/annotate returned ${response.status} with an empty body`,
    );
  }
  try {
    return JSON.parse(text) as RecordAnnotationResult;
  } catch {
    throw new Error(
      `recordAnnotation: runtime ${runtimeUrl}/annotate returned a non-JSON body (status ${response.status})`,
    );
  }
}
