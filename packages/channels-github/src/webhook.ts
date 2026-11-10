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

/** The work `onEvent` leaves for after the response, such as running the agent. */
export type GitHubWebhookDispatch = () => Promise<void>;

/** Options for {@link createWebhookHandler}. */
export interface GitHubWebhookHandlerOptions {
  /** Webhook secret set on the GitHub App or repository webhook. */
  secret: string;
  /**
   * Called with each verified delivery (except `ping`) before the response.
   * Do the fast reads here. When it throws, the handler answers `500`. Return
   * a dispatch function for the slow work: it runs after the `200`.
   */
  onEvent: (
    event: GitHubWebhookEvent,
  ) => Promise<GitHubWebhookDispatch | void> | GitHubWebhookDispatch | void;
  /**
   * Called when `onEvent` or its dispatch function throws or rejects. Defaults
   * to `console.error` with a `[channels-github]` prefix. Errors never surface
   * as unhandled rejections.
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
 * The handler verifies `X-Hub-Signature-256` against `secret` and awaits
 * `onEvent`. When `onEvent` succeeds, the handler answers `200` and then runs
 * the dispatch function that `onEvent` returned, in the background. When
 * `onEvent` fails, the handler answers `500`. GitHub does not retry a failed
 * delivery by itself, but you can redeliver it from the webhook settings.
 *
 * The handler works anywhere that speaks `Request`/`Response`: Hono, Next.js
 * route handlers, Workers, or Node 18+ (see `GitHubWebhookServer` for a
 * built-in `node:http` server).
 *
 * Responses:
 * - `405` for any method except `POST`
 * - `401` when the signature is missing or wrong
 * - `400` when `X-GitHub-Event` or `X-GitHub-Delivery` is missing, or the body is not JSON
 * - `200` for `ping` (no dispatch) and for every accepted delivery
 * - `500` when `onEvent` throws or rejects
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
      `[channels-github] handling ${event.name} delivery ${event.deliveryId} failed:`,
      error,
    );
  };

  const runInBackground = (
    dispatch: GitHubWebhookDispatch,
    event: GitHubWebhookEvent,
  ) => {
    void Promise.resolve()
      .then(dispatch)
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

    const event = { name, deliveryId, payload: parsed.value };
    try {
      const dispatch = await onEvent(event);
      if (dispatch) runInBackground(dispatch, event);
    } catch (error) {
      reportError(error, event);
      return emptyResponse(500);
    }
    return emptyResponse(200);
  };
}
