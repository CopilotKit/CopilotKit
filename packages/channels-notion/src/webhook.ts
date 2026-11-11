import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  NotionAdapterOptions,
  NotionVerificationBody,
  NotionWebhookEvent,
} from "./types.js";

/** Options for {@link createWebhookHandler}. */
export interface WebhookHandlerOptions extends Pick<
  NotionAdapterOptions,
  "verificationToken" | "onVerificationToken"
> {
  /**
   * Called with every signed event, before the response. Every event type is
   * passed through; filter on `event.type` yourself.
   *
   * Do the reads that can fail here, and keep them fast: Notion waits for the
   * response. When `onEvent` rejects, the response is 500 and Notion retries
   * the delivery. Return a function for the slow work: it runs after the 200
   * response.
   */
  onEvent: (event: NotionWebhookEvent) => Promise<void | (() => Promise<void>)>;
  /**
   * Called when `onEvent`, the function it returns, or `onVerificationToken`
   * throws or rejects (default: `console.error` with a `[channels-notion]`
   * prefix).
   */
  onError?: (error: unknown) => void;
}

const SIGNATURE_HEADER = "x-notion-signature";
const SIGNATURE_PREFIX = "sha256=";

function isVerificationBody(body: unknown): body is NotionVerificationBody {
  const isObject = typeof body === "object" && body !== null;
  if (!isObject) return false;
  return (
    "verification_token" in body &&
    typeof body.verification_token === "string" &&
    !("type" in body)
  );
}

/** HMAC-SHA256 over the raw body bytes, keyed with the verification token. */
function hasValidSignature(
  rawBody: Buffer,
  signature: string | null,
  verificationToken: string,
) {
  if (signature === null || !signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const expected =
    SIGNATURE_PREFIX +
    createHmac("sha256", verificationToken).update(rawBody).digest("hex");
  const received = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function defaultOnError(error: unknown) {
  console.error("[channels-notion] webhook handler failed:", error);
}

/**
 * Creates a fetch-style handler for Notion webhook POSTs.
 *
 * - The one-time verification POST (`{ "verification_token": "..." }`) gets a
 *   200. While `verificationToken` is not set, the token goes to
 *   `onVerificationToken`, or to `console.info` when that callback is not set.
 *   Once `verificationToken` is set, verification POSTs are ignored, because
 *   they are unsigned.
 * - Every other POST must carry a valid `X-Notion-Signature` header, signed
 *   with `verificationToken`. Without a configured token, or with a bad
 *   signature, the response is 401.
 * - A signed event goes to `onEvent`, and the handler waits for it. When it
 *   rejects, the response is 500, so Notion retries the delivery. When it
 *   resolves, the response is 200, and the function it returned (if any) runs
 *   after the response.
 *
 * Mount it on any framework that speaks `Request`/`Response`:
 *
 * ```ts
 * const handleWebhook = createWebhookHandler({
 *   verificationToken: process.env.NOTION_VERIFICATION_TOKEN,
 *   onEvent: async (event) => {
 *     if (event.type !== "comment.created") return;
 *     const comment = await fetchComment(event.entity.id); // a failure answers 500
 *     return () => replyTo(comment); // runs after the 200
 *   },
 * });
 * app.post("/webhook", (c) => handleWebhook(c.req.raw));
 * ```
 *
 * @param options.verificationToken - Key for the signature check.
 * @param options.onVerificationToken - Receives the token from the verification POST.
 * @param options.onEvent - Prepares each signed event, and may return the work to run after the response.
 * @param options.onError - Receives errors thrown by the callbacks.
 * @returns `(request: Request) => Promise<Response>`.
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const { verificationToken, onVerificationToken, onEvent } = options;
  const onError = options.onError ?? defaultOnError;
  let warnedMissingToken = false;

  const runLater = (task: () => void | Promise<void>) => {
    setTimeout(() => {
      Promise.resolve()
        .then(task)
        .catch((error: unknown) => onError(error));
    }, 0);
  };

  return async (request: Request) => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }

    const rawBody = Buffer.from(await request.arrayBuffer());
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return new Response(null, { status: 400 });
    }

    if (isVerificationBody(body)) {
      // The verification POST is unsigned. Once a token is configured, ignore
      // it so a forged request cannot hand the operator an attacker's token.
      if (verificationToken !== undefined) {
        return new Response(null, { status: 200 });
      }
      const token = body.verification_token;
      if (onVerificationToken) {
        runLater(() => onVerificationToken(token));
      } else {
        console.info(
          `[channels-notion] Notion sent the webhook verification token: ${token}. Set it as verificationToken.`,
        );
      }
      return new Response(null, { status: 200 });
    }

    if (verificationToken === undefined) {
      if (!warnedMissingToken) {
        warnedMissingToken = true;
        console.warn(
          "[channels-notion] Rejected a webhook event because verificationToken is not set. Set it to the token from the Notion verification request.",
        );
      }
      return new Response(null, { status: 401 });
    }

    const signature = request.headers.get(SIGNATURE_HEADER);
    if (!hasValidSignature(rawBody, signature, verificationToken)) {
      return new Response(null, { status: 401 });
    }

    // A signed body comes from Notion, so it has the documented event shape.
    const event: NotionWebhookEvent = body as NotionWebhookEvent;
    let dispatch: void | (() => Promise<void>);
    try {
      dispatch = await onEvent(event);
    } catch (error) {
      // A 500 makes Notion retry the delivery.
      onError(error);
      return new Response(null, { status: 500 });
    }
    if (dispatch) runLater(dispatch);
    return new Response(null, { status: 200 });
  };
}
