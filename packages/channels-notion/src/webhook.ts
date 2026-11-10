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
   * Called with every signed event, after the 200 response is returned.
   * Every event type is passed through; filter on `event.type` yourself.
   */
  onEvent: (event: NotionWebhookEvent) => void | Promise<void>;
  /**
   * Called when `onEvent` or `onVerificationToken` throws or rejects
   * (default: `console.error` with a `[channels-notion]` prefix).
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
 * - A signed event gets a 200 at once. `onEvent` runs after the response.
 *
 * Mount it on any framework that speaks `Request`/`Response`:
 *
 * ```ts
 * const handleWebhook = createWebhookHandler({
 *   verificationToken: process.env.NOTION_VERIFICATION_TOKEN,
 *   onEvent: async (event) => {
 *     if (event.type === "comment.created") await handleComment(event);
 *   },
 * });
 * app.post("/webhook", (c) => handleWebhook(c.req.raw));
 * ```
 *
 * @param options.verificationToken - Key for the signature check.
 * @param options.onVerificationToken - Receives the token from the verification POST.
 * @param options.onEvent - Receives each signed event.
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
    runLater(() => onEvent(event));
    return new Response(null, { status: 200 });
  };
}
