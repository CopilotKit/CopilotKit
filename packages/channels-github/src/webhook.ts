import { createHmac, timingSafeEqual } from "node:crypto";

/** One verified GitHub webhook delivery, as passed to `onEvent`. */
export interface GitHubWebhookEvent {
  /** Event name from the `X-GitHub-Event` header, e.g. `"issue_comment"`. */
  name: string;
  /** Delivery id from the `X-GitHub-Delivery` header. Unique per delivery; use it to drop retries. */
  deliveryId: string;
  /** Parsed JSON body. Narrow it by `name` before use. */
  payload: unknown;
}

/** Options for {@link createWebhookHandler}. */
export interface GitHubWebhookHandlerOptions {
  /** Webhook secret set on the GitHub App or repository webhook. */
  secret: string;
  /** Called after the 200 ack with each verified delivery (except `ping`). */
  onEvent: (event: GitHubWebhookEvent) => Promise<void> | void;
  /**
   * Called when `onEvent` throws or rejects. Defaults to `console.error` with a
   * `[channels-github]` prefix. Errors never surface as unhandled rejections.
   */
  onError?: (error: unknown, event: GitHubWebhookEvent) => void;
}

const SIGNATURE_PREFIX = "sha256=";

function isValidSignature(
  secret: string,
  body: Uint8Array,
  signature: string | null,
) {
  if (signature === null || !signature.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }
  const expected =
    SIGNATURE_PREFIX + createHmac("sha256", secret).update(body).digest("hex");
  const received = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function emptyResponse(status: number, headers?: HeadersInit) {
  return new Response(null, { status, headers });
}

function parseJson(text: string) {
  try {
    return { ok: true, value: JSON.parse(text) as unknown } as const;
  } catch {
    return { ok: false } as const;
  }
}

/**
 * Create a Web-standard request handler for GitHub webhooks.
 *
 * The handler verifies `X-Hub-Signature-256` against `secret`, answers `200`
 * at once, and then calls `onEvent` in the background. It works anywhere that
 * speaks `Request`/`Response`: Hono, Next.js route handlers, Workers, or
 * Node 18+ (see `GitHubWebhookServer` for a built-in `node:http` server).
 *
 * Responses:
 * - `405` for any method except `POST`
 * - `401` when the signature is missing or wrong
 * - `400` when `X-GitHub-Event` or `X-GitHub-Delivery` is missing, or the body is not JSON
 * - `200` for `ping` (no dispatch) and for every accepted delivery
 *
 * @example
 * ```ts
 * const handleWebhook = createWebhookHandler({
 *   secret: process.env.GITHUB_WEBHOOK_SECRET!,
 *   onEvent: async ({ name, payload }) => { ... },
 * });
 * app.post("/webhook", (c) => handleWebhook(c.req.raw));
 * ```
 */
export function createWebhookHandler(options: GitHubWebhookHandlerOptions) {
  const { secret, onEvent, onError } = options;

  const reportError = (error: unknown, event: GitHubWebhookEvent) => {
    try {
      if (onError) {
        onError(error, event);
        return;
      }
    } catch (handlerError) {
      console.error("[channels-github] onError threw:", handlerError);
    }
    console.error(
      `[channels-github] onEvent failed for ${event.name} delivery ${event.deliveryId}:`,
      error,
    );
  };

  const dispatch = (event: GitHubWebhookEvent) => {
    void Promise.resolve()
      .then(() => onEvent(event))
      .catch((error: unknown) => reportError(error, event));
  };

  return async (request: Request) => {
    if (request.method !== "POST") {
      return emptyResponse(405, { allow: "POST" });
    }

    const body = new Uint8Array(await request.arrayBuffer());
    const signature = request.headers.get("x-hub-signature-256");
    if (!isValidSignature(secret, body, signature)) {
      return emptyResponse(401);
    }

    const name = request.headers.get("x-github-event");
    const deliveryId = request.headers.get("x-github-delivery");
    if (!name || !deliveryId) {
      return emptyResponse(400);
    }
    if (name === "ping") {
      return emptyResponse(200);
    }

    const parsed = parseJson(new TextDecoder().decode(body));
    if (!parsed.ok) {
      return emptyResponse(400);
    }

    dispatch({ name, deliveryId, payload: parsed.value });
    return emptyResponse(200);
  };
}
