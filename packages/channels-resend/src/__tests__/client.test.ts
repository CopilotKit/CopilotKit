import { describe, expect, it, vi } from "vitest";
import { ResendApiError, ResendClient, retryDelayMs } from "../client.js";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function setup(responses: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next();
    },
  ) as unknown as typeof globalThis.fetch;
  const sleeps: number[] = [];
  const client = new ResendClient({
    apiKey: "re_test",
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps };
}

const EMAIL = {
  from: "Bot <bot@example.com>",
  to: ["ann@example.com"],
  subject: "Hi",
  text: "Hello",
};

describe("ResendClient", () => {
  it("sends with auth, a User-Agent, and an idempotency key", async () => {
    const { client, calls } = setup([() => jsonResponse(200, { id: "e1" })]);
    await expect(client.sendEmail(EMAIL)).resolves.toEqual({ id: "e1" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://api.resend.com/emails");
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["user-agent"]).toBeTruthy();
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(EMAIL);
  });

  it("retries a 429 after retry-after, with the same idempotency key", async () => {
    const { client, calls, sleeps } = setup([
      () =>
        jsonResponse(
          429,
          { name: "rate_limit_exceeded", message: "slow down" },
          { "retry-after": "2" },
        ),
      () =>
        jsonResponse(
          429,
          { name: "rate_limit_exceeded" },
          { "ratelimit-reset": "1" },
        ),
      () => jsonResponse(200, { id: "e2" }),
    ]);
    await expect(client.sendEmail(EMAIL)).resolves.toEqual({ id: "e2" });
    expect(sleeps).toEqual([2000, 1000]);
    const keys = calls.map(
      (c) => (c.init.headers as Record<string, string>)["idempotency-key"],
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("backs off exponentially on a 429 without retry-after and on 5xx", async () => {
    const { client, sleeps } = setup([
      () => jsonResponse(429, { name: "rate_limit_exceeded" }),
      () => jsonResponse(503, { name: "service_unavailable" }),
      () => jsonResponse(200, { id: "e3" }),
    ]);
    await client.sendEmail(EMAIL);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("does not retry a daily or monthly quota error", async () => {
    const { client, calls } = setup([
      () =>
        jsonResponse(429, { name: "daily_quota_exceeded", message: "quota" }),
    ]);
    await expect(client.sendEmail(EMAIL)).rejects.toMatchObject({
      status: 429,
      code: "daily_quota_exceeded",
    });
    expect(calls).toHaveLength(1);
  });

  it("does not retry a validation error", async () => {
    const { client, calls } = setup([
      () =>
        jsonResponse(422, { name: "validation_error", message: "bad from" }),
    ]);
    const error = await client.sendEmail(EMAIL).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ResendApiError);
    expect((error as Error).message).toBe("bad from");
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxRetries", async () => {
    const { client, calls } = setup(
      Array.from(
        { length: 4 },
        () => () =>
          jsonResponse(
            429,
            { name: "rate_limit_exceeded" },
            { "retry-after": "0" },
          ),
      ),
    );
    await expect(client.sendEmail(EMAIL)).rejects.toMatchObject({
      status: 429,
    });
    expect(calls).toHaveLength(4);
  });

  it("does not wait for a retry-after longer than a minute", async () => {
    const { client, sleeps } = setup([
      () =>
        jsonResponse(
          429,
          { name: "rate_limit_exceeded" },
          { "retry-after": "3600" },
        ),
    ]);
    await expect(client.sendEmail(EMAIL)).rejects.toMatchObject({
      status: 429,
    });
    expect(sleeps).toEqual([]);
  });

  it("reads retry-after as an HTTP date", () => {
    const now = Date.parse("2026-11-10T10:00:00Z");
    const headers = new Headers({
      "retry-after": "Tue, 10 Nov 2026 10:00:03 GMT",
    });
    expect(retryDelayMs(headers, now)).toBe(3000);
  });

  it("fetches a received email and its attachments", async () => {
    const { client, calls } = setup([
      () => jsonResponse(200, { id: "in1", from: "a@b.c" }),
      () => jsonResponse(200, { object: "list", data: [{ id: "att1" }] }),
    ]);
    await client.getReceivedEmail("in1");
    await expect(client.listReceivedAttachments("in1")).resolves.toEqual([
      { id: "att1" },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.resend.com/emails/receiving/in1",
      "https://api.resend.com/emails/receiving/in1/attachments?limit=100",
    ]);
  });

  it("stops a download that passes the size cap", async () => {
    const { client } = setup([() => new Response(new Uint8Array(2048))]);
    await expect(client.download("https://cdn.test/f", 1024)).rejects.toThrow(
      "larger than 1024",
    );
  });
});
