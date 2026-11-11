import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebhookHandler } from "./webhook.js";
import type { GitHubWebhookDispatch, GitHubWebhookEvent } from "./webhook.js";

const SECRET = "test-secret";
const DELIVERY_ID = "72d3162e-cc78-11e3-81ab-4c9367dc0958";
const PAYLOAD = { action: "created", comment: { id: 7, body: "@bot hi" } };
const EVENT: GitHubWebhookEvent = {
  name: "issue_comment",
  deliveryId: DELIVERY_ID,
  payload: PAYLOAD,
};

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

interface DeliveryInit {
  body?: string;
  method?: string;
  event?: string | null;
  deliveryId?: string | null;
  signature?: string | null;
}

function delivery(init: DeliveryInit = {}) {
  const method = init.method ?? "POST";
  const body = init.body ?? JSON.stringify(PAYLOAD);
  const headers = new Headers({ "content-type": "application/json" });
  const event = init.event === undefined ? "issue_comment" : init.event;
  const deliveryId =
    init.deliveryId === undefined ? DELIVERY_ID : init.deliveryId;
  const signature = init.signature === undefined ? sign(body) : init.signature;
  if (event !== null) headers.set("x-github-event", event);
  if (deliveryId !== null) headers.set("x-github-delivery", deliveryId);
  if (signature !== null) headers.set("x-hub-signature-256", signature);
  return new Request("http://localhost/webhook", {
    method,
    headers,
    body: method === "GET" ? undefined : body,
  });
}

function setup(
  onEvent: (
    event: GitHubWebhookEvent,
  ) => Promise<GitHubWebhookDispatch | void> = async () => {},
) {
  const events: GitHubWebhookEvent[] = [];
  const errors: Array<{ error: unknown; event: GitHubWebhookEvent }> = [];
  const handler = createWebhookHandler({
    secret: SECRET,
    onEvent: async (event) => {
      events.push(event);
      return onEvent(event);
    },
    onError: (error, event) => errors.push({ error, event }),
  });
  return { handler, events, errors };
}

/** Let the background dispatch (microtasks + one macrotask) run. */
function flushDispatch() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookHandler", () => {
  it("acks 200 and dispatches the verified delivery with its parsed payload", async () => {
    const { handler, events } = setup();

    const response = await handler(delivery());
    await flushDispatch();

    expect(response.status).toBe(200);
    expect(events).toEqual([EVENT]);
  });

  it("waits for onEvent before it answers", async () => {
    let finishPrepare = () => {};
    const { handler } = setup(
      () =>
        new Promise<void>((resolve) => {
          finishPrepare = resolve;
        }),
    );
    let status: number | undefined;

    const answered = handler(delivery()).then((response) => {
      status = response.status;
    });
    await flushDispatch();
    expect(status).toBeUndefined();

    finishPrepare();
    await answered;
    expect(status).toBe(200);
  });

  it("answers 200, then runs the dispatch that onEvent returned without waiting for it", async () => {
    let dispatched = 0;
    const { handler } = setup(async () => async () => {
      dispatched += 1;
      await new Promise<void>(() => {});
    });

    const response = await handler(delivery());
    await flushDispatch();

    expect(response.status).toBe(200);
    expect(dispatched).toBe(1);
  });

  it.each([
    {
      label: "wrong secret",
      signature: sign(JSON.stringify(PAYLOAD), "other"),
    },
    { label: "missing header", signature: null },
    { label: "no sha256= prefix", signature: "deadbeef" },
  ])(
    "rejects a delivery with a bad signature ($label) with 401",
    async ({ signature }) => {
      const { handler, events } = setup();

      const response = await handler(delivery({ signature }));
      await flushDispatch();

      expect(response.status).toBe(401);
      expect(events).toEqual([]);
    },
  );

  it("accepts GitHub's published signature test vector (body is not JSON, so 400 not 401)", async () => {
    // Vector from GitHub docs "Validating webhook deliveries".
    const handler = createWebhookHandler({
      secret: "It's a Secret to Everybody",
      onEvent: () => {},
    });

    const response = await handler(
      delivery({
        body: "Hello, World!",
        signature:
          "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
      }),
    );

    expect(response.status).toBe(400);
  });

  it("answers 405 for methods other than POST", async () => {
    const { handler } = setup();

    const response = await handler(delivery({ method: "GET" }));

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it.each([
    { label: "X-GitHub-Event", init: { event: null } },
    { label: "X-GitHub-Delivery", init: { deliveryId: null } },
  ])("answers 400 when $label is missing", async ({ init }) => {
    const { handler, events } = setup();

    const response = await handler(delivery(init));
    await flushDispatch();

    expect(response.status).toBe(400);
    expect(events).toEqual([]);
  });

  it("answers ping with 200 and does not dispatch", async () => {
    const { handler, events } = setup();

    const response = await handler(
      delivery({
        event: "ping",
        body: JSON.stringify({ zen: "Keep it simple." }),
      }),
    );
    await flushDispatch();

    expect(response.status).toBe(200);
    expect(events).toEqual([]);
  });

  it("answers 400 for a signed body that is not JSON", async () => {
    const { handler, events } = setup();

    const response = await handler(delivery({ body: "{not json" }));
    await flushDispatch();

    expect(response.status).toBe(400);
    expect(events).toEqual([]);
  });

  it("answers 500 and routes the error to onError when onEvent rejects", async () => {
    const failure = new Error("state store down");
    const { handler, errors } = setup(async () => {
      throw failure;
    });

    const response = await handler(delivery());

    expect(response.status).toBe(500);
    expect(errors).toEqual([{ error: failure, event: EVENT }]);
  });

  it("routes a dispatch rejection to onError after the 200", async () => {
    const failure = new Error("agent down");
    const { handler, errors } = setup(async () => async () => {
      throw failure;
    });

    const response = await handler(delivery());
    await flushDispatch();

    expect(response.status).toBe(200);
    expect(errors).toEqual([{ error: failure, event: EVENT }]);
  });

  it("logs an onEvent failure with a [channels-github] prefix when onError is not set", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("agent down");
    const handler = createWebhookHandler({
      secret: SECRET,
      onEvent: () => {
        throw failure;
      },
    });

    const response = await handler(delivery());

    expect(response.status).toBe(500);
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [message, loggedError] = consoleError.mock.calls[0] ?? [];
    expect(String(message).startsWith("[channels-github]")).toBe(true);
    expect(loggedError).toBe(failure);
  });
});
