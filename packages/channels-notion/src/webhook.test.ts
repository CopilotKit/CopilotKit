import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotionWebhookEvent } from "./types.js";
import { createWebhookHandler } from "./webhook.js";
import type { WebhookHandlerOptions } from "./webhook.js";

const TOKEN = "secret_verification_token";

const EVENT: NotionWebhookEvent = {
  id: "evt-1",
  timestamp: "2026-11-10T12:00:00.000Z",
  workspace_id: "ws-1",
  subscription_id: "sub-1",
  integration_id: "int-1",
  type: "comment.created",
  authors: [{ id: "user-1", type: "person" }],
  attempt_number: 1,
  entity: { id: "comment-1", type: "comment" },
  data: { page_id: "page-1", parent: { id: "page-1", type: "page" } },
};

function sign(rawBody: string, key = TOKEN) {
  return "sha256=" + createHmac("sha256", key).update(rawBody).digest("hex");
}

function postRequest(rawBody: string, signature?: string) {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("x-notion-signature", signature);
  return new Request("http://localhost/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  });
}

function makeHandler(overrides: Partial<WebhookHandlerOptions> = {}) {
  const onEvent = vi.fn<WebhookHandlerOptions["onEvent"]>();
  const handler = createWebhookHandler({
    verificationToken: TOKEN,
    onEvent,
    ...overrides,
  });
  return { handler, onEvent };
}

/** Lets the handler's deferred dispatch run. */
function flushDispatch() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookHandler", () => {
  describe("verification request", () => {
    const verificationBody = JSON.stringify({
      verification_token: "secret_from_notion",
    });

    it("responds 200 and passes the token to onVerificationToken", async () => {
      const onVerificationToken = vi.fn();
      const { handler } = makeHandler({
        verificationToken: undefined,
        onVerificationToken,
      });

      const response = await handler(postRequest(verificationBody));

      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(onVerificationToken).toHaveBeenCalledWith("secret_from_notion"),
      );
    });

    it("logs the token with console.info when no callback is set", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const { handler } = makeHandler({ verificationToken: undefined });

      const response = await handler(postRequest(verificationBody));

      expect(response.status).toBe(200);
      expect(info).toHaveBeenCalledWith(
        "[channels-notion] Notion sent the webhook verification token: secret_from_notion. Set it as verificationToken.",
      );
    });

    it("ignores the unsigned token once verificationToken is set", async () => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const onVerificationToken = vi.fn();
      const { handler, onEvent } = makeHandler({ onVerificationToken });

      const response = await handler(postRequest(verificationBody));
      await flushDispatch();

      expect(response.status).toBe(200);
      expect(onVerificationToken).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe("signed event", () => {
    const rawBody = JSON.stringify(EVENT);

    it("awaits onEvent, responds 200, then runs the dispatch it returned", async () => {
      const dispatch = vi.fn(async () => {});
      const onEvent = vi.fn(async () => dispatch);
      const { handler } = makeHandler({ onEvent });

      const response = await handler(postRequest(rawBody, sign(rawBody)));

      expect(response.status).toBe(200);
      expect(onEvent).toHaveBeenCalledWith(EVENT);
      expect(dispatch).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    });

    it("checks the signature over the raw bytes, not re-serialized JSON", async () => {
      const { handler, onEvent } = makeHandler();
      const prettyBody = JSON.stringify(EVENT, null, 2);

      const response = await handler(postRequest(prettyBody, sign(prettyBody)));

      expect(response.status).toBe(200);
      expect(onEvent).toHaveBeenCalledWith(EVENT);
    });

    it("responds 500 when onEvent rejects, so Notion retries, and sends the error to onError", async () => {
      const failure = new Error("Notion returned 503");
      const onError = vi.fn();
      const { handler } = makeHandler({
        onEvent: () => Promise.reject(failure),
        onError,
      });

      const response = await handler(postRequest(rawBody, sign(rawBody)));

      expect(response.status).toBe(500);
      expect(onError).toHaveBeenCalledWith(failure);
    });

    it("responds 200 and sends a rejected dispatch to onError", async () => {
      const failure = new Error("agent down");
      const onError = vi.fn();
      const { handler } = makeHandler({
        onEvent: async () => () => Promise.reject(failure),
        onError,
      });

      const response = await handler(postRequest(rawBody, sign(rawBody)));

      expect(response.status).toBe(200);
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    });
  });

  describe("rejections", () => {
    const rawBody = JSON.stringify(EVENT);

    it.each([
      ["a signature made with another key", sign(rawBody, "wrong_key")],
      ["no signature header", undefined],
    ])("responds 401 for %s", async (_label, signature) => {
      const { handler, onEvent } = makeHandler();

      const response = await handler(postRequest(rawBody, signature));
      await flushDispatch();

      expect(response.status).toBe(401);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("responds 401 and warns once when verificationToken is not set", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { handler, onEvent } = makeHandler({
        verificationToken: undefined,
      });

      const first = await handler(postRequest(rawBody, sign(rawBody)));
      const second = await handler(postRequest(rawBody, sign(rawBody)));
      await flushDispatch();

      expect([first.status, second.status]).toEqual([401, 401]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(onEvent).not.toHaveBeenCalled();
    });

    it("responds 405 to a non-POST request", async () => {
      const { handler } = makeHandler();

      const response = await handler(
        new Request("http://localhost/webhook", { method: "GET" }),
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    });

    it("responds 400 to a body that is not JSON", async () => {
      const { handler } = makeHandler();
      const badBody = "{not json";

      const response = await handler(postRequest(badBody, sign(badBody)));

      expect(response.status).toBe(400);
    });
  });
});
