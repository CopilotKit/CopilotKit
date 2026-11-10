import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createWebhookHandler } from "./webhook.js";
import type { AgentSessionEventWebhook } from "./types.js";

const SECRET = "lin_wh_secret";
const NOW = 1_700_000_000_000;

function createEvent(
  overrides?: Partial<AgentSessionEventWebhook>,
): AgentSessionEventWebhook {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: "org-1",
    createdAt: "2023-11-14T22:13:20.000Z",
    webhookTimestamp: NOW,
    agentSession: { id: "session-1" },
    promptContext: "<issue>ENG-1</issue>",
    ...overrides,
  };
}

function sign(body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function signedRequest(body: string, signature: string | null = sign(body)) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set("linear-signature", signature);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body,
  });
}

function setup(
  onEvent = vi.fn(async (_event: AgentSessionEventWebhook) => {}),
) {
  const onError = vi.fn((_error: unknown) => {});
  const handler = createWebhookHandler({
    secret: SECRET,
    onEvent,
    onError,
    now: () => NOW,
  });
  return { handler, onEvent, onError };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookHandler", () => {
  it("acks 200 without waiting for onEvent, then dispatches the payload", async () => {
    // onEvent never settles: a handler that awaited it would never return.
    const { handler, onEvent } = setup(
      vi.fn((_event: AgentSessionEventWebhook) => new Promise<void>(() => {})),
    );
    const event = createEvent();

    const response = await handler(signedRequest(JSON.stringify(event)));

    expect(response.status).toBe(200);
    await flush();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0]?.[0]).toEqual({
      type: "AgentSessionEvent",
      action: "created",
      organizationId: "org-1",
      createdAt: "2023-11-14T22:13:20.000Z",
      webhookTimestamp: NOW,
      agentSession: { id: "session-1" },
      promptContext: "<issue>ENG-1</issue>",
    });
  });

  it.each([
    ["missing", () => null],
    ["wrong-secret", (body: string) => sign(body, "other-secret")],
    ["malformed", () => "not-a-signature"],
  ])("rejects a %s signature with 401", async (_label, signatureFor) => {
    const { handler, onEvent } = setup();
    const body = JSON.stringify(createEvent());

    const response = await handler(signedRequest(body, signatureFor(body)));

    expect(response.status).toBe(401);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["older than 60 s", NOW - 60_001],
    ["more than 60 s ahead", NOW + 60_001],
  ])("rejects a webhookTimestamp %s with 401", async (_label, timestamp) => {
    const { handler, onEvent } = setup();
    const body = JSON.stringify(createEvent({ webhookTimestamp: timestamp }));

    const response = await handler(signedRequest(body));

    expect(response.status).toBe(401);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("accepts a webhookTimestamp exactly 60 s old", async () => {
    const { handler } = setup();
    const body = JSON.stringify(
      createEvent({ webhookTimestamp: NOW - 60_000 }),
    );

    const response = await handler(signedRequest(body));

    expect(response.status).toBe(200);
  });

  it("rejects a payload with no webhookTimestamp with 401", async () => {
    const { handler, onEvent } = setup();
    const body = JSON.stringify({
      type: "AgentSessionEvent",
      action: "created",
    });

    const response = await handler(signedRequest(body));

    expect(response.status).toBe(401);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("acks other event types with 200 and does not dispatch them", async () => {
    const { handler, onEvent } = setup();
    const body = JSON.stringify({
      type: "Issue",
      action: "update",
      webhookTimestamp: NOW,
    });

    const response = await handler(signedRequest(body));

    expect(response.status).toBe(200);
    await flush();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("answers a non-POST request with 405", async () => {
    const { handler } = setup();

    const response = await handler(
      new Request("http://localhost/webhook", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a JSON value that is not an object", "null"],
  ])("answers a signed body with %s with 400", async (_label, body) => {
    const { handler } = setup();

    const response = await handler(signedRequest(body));

    expect(response.status).toBe(400);
  });

  it("sends an onEvent rejection to onError", async () => {
    const failure = new Error("agent run failed");
    const { handler, onError } = setup(
      vi.fn(async (_event: AgentSessionEventWebhook) => {
        throw failure;
      }),
    );

    const response = await handler(
      signedRequest(JSON.stringify(createEvent())),
    );

    expect(response.status).toBe(200);
    await flush();
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("logs an onEvent rejection with the package prefix when onError is not set", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("agent run failed");
    const handler = createWebhookHandler({
      secret: SECRET,
      onEvent: async () => {
        throw failure;
      },
      now: () => NOW,
    });

    await handler(signedRequest(JSON.stringify(createEvent())));
    await flush();

    expect(consoleError).toHaveBeenCalledWith(
      "[channels-linear] webhook onEvent failed:",
      failure,
    );
  });
});
