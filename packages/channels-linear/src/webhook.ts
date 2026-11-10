import { createHmac, timingSafeEqual } from "node:crypto";
import type { AgentSessionEventWebhook } from "./types.js";

/** Largest allowed gap between `webhookTimestamp` and now, in milliseconds. */
export const MAX_WEBHOOK_AGE_MS = 60_000;

export interface WebhookHandlerOptions {
  /** Webhook signing secret. Verifies the `Linear-Signature` header. */
  secret: string;
  /**
   * Called with every verified `AgentSessionEvent` payload. Runs after the
   * handler has returned its 200, so Linear gets its ack inside 5 s.
   */
  onEvent: (event: AgentSessionEventWebhook) => Promise<void>;
  /** Receives errors from `onEvent`. Default logs with `console.error`. */
  onError?: (error: unknown) => void;
  /** Clock in Unix milliseconds, for the freshness check. Default `Date.now`. */
  now?: () => number;
}

function logDispatchError(error: unknown) {
  console.error("[channels-linear] webhook onEvent failed:", error);
}

function status(code: number, headers?: HeadersInit) {
  return new Response(null, { status: code, headers });
}

/** Compares the hex HMAC-SHA256 of the raw body with the `Linear-Signature` header. */
function isValidSignature(
  secret: string,
  body: Buffer,
  signature: string | null,
) {
  if (signature === null) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(body).digest("hex"),
  );
  const received = Buffer.from(signature);
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

/**
 * Creates a fetch-style handler for Linear webhooks.
 *
 * The handler accepts POST only. It verifies `Linear-Signature` against the raw
 * body, rejects payloads whose `webhookTimestamp` is more than 60 s from now,
 * and answers 200 at once. `AgentSessionEvent` payloads go to `onEvent` after
 * the response; other event types are acknowledged and dropped.
 *
 * Responses: 405 wrong method, 401 bad signature or stale timestamp,
 * 400 body is not a JSON object, 200 otherwise.
 *
 * @param options.secret - The webhook signing secret from the Linear app settings.
 * @param options.onEvent - Async callback for each `AgentSessionEvent`.
 * @param options.onError - Optional sink for `onEvent` failures.
 * @param options.now - Optional clock, for tests.
 *
 * @example
 * ```ts
 * const handleWebhook = createWebhookHandler({
 *   secret: process.env.LINEAR_WEBHOOK_SECRET!,
 *   onEvent: async (event) => { ... },
 * });
 * app.post("/webhook", (c) => handleWebhook(c.req.raw));
 * ```
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const {
    secret,
    onEvent,
    onError = logDispatchError,
    now = Date.now,
  } = options;

  return async (request: Request) => {
    if (request.method !== "POST") return status(405, { allow: "POST" });

    const body = Buffer.from(await request.arrayBuffer());
    const signature = request.headers.get("linear-signature");
    if (!isValidSignature(secret, body, signature)) return status(401);

    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return status(400);
    }
    if (typeof payload !== "object" || payload === null) return status(400);

    const timestamp =
      "webhookTimestamp" in payload ? payload.webhookTimestamp : undefined;
    const isFresh =
      typeof timestamp === "number" &&
      Math.abs(now() - timestamp) <= MAX_WEBHOOK_AGE_MS;
    if (!isFresh) return status(401);

    const isAgentSessionEvent =
      "type" in payload && payload.type === "AgentSessionEvent";
    if (isAgentSessionEvent) {
      // Signed by Linear and tagged `AgentSessionEvent`: trust the documented shape.
      const event = payload as AgentSessionEventWebhook;
      // Dispatch without awaiting so the 200 is not held up by the agent run.
      void Promise.resolve()
        .then(() => onEvent(event))
        .catch(onError);
    }
    return status(200);
  };
}
