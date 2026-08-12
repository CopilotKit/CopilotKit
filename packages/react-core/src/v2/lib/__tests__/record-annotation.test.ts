import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordAnnotation } from "../record-annotation";

// Override randomUUID with a counter so each call produces a distinct,
// predictable value (mirrors the pattern used in the hook tests).
let uuidCounter = 0;
vi.mock("@copilotkit/shared", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@copilotkit/shared");
  return {
    ...actual,
    randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
  };
});

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
  body: Record<string, unknown> | null;
}

const mockFetch = (
  responses: Array<{ status: number; body: unknown }>,
): { calls: FetchCall[]; fetch: typeof globalThis.fetch } => {
  const calls: FetchCall[] = [];
  let index = 0;
  const fetch = vi.fn(async (url, init) => {
    let parsedBody: Record<string, unknown> | null = null;
    if (init?.body && typeof init.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = null;
      }
    }
    calls.push({ url: String(url), init, body: parsedBody });
    const response = responses[index++] ?? responses[responses.length - 1]!;
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  uuidCounter = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

it("POSTs the correct wire body to ${runtimeUrl}/annotate", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "evt-1", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  const result = await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "user_action",
    payload: { title: "Renamed project", data: { old: "Foo" } },
    threadId: "thread-1",
  });

  expect(result).toEqual({ id: "evt-1", duplicate: false });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://bff.example.com/api/copilotkit/annotate");
  expect(calls[0]!.init?.method).toBe("POST");
  expect(calls[0]!.body).toMatchObject({
    type: "user_action",
    payload: { title: "Renamed project", data: { old: "Foo" } },
    threadId: "thread-1",
  });
  expect(calls[0]!.body).not.toHaveProperty("userId");
  expect(typeof calls[0]!.body!.clientEventId).toBe("string");
  expect((calls[0]!.body!.clientEventId as string).length).toBeGreaterThan(0);
});

it("uses the caller-supplied clientEventId verbatim when provided", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "evt-2", duplicate: true } },
  ]);
  globalThis.fetch = fetch;

  await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "set_learning_containers",
    payload: { containers: ["org", "user"] },
    threadId: "t",
    clientEventId: "my-stable-id",
  });

  expect(calls[0]!.body!.clientEventId).toBe("my-stable-id");
  expect(calls[0]!.body).not.toHaveProperty("userId");
});

it("auto-generates a distinct clientEventId per call when not supplied", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
    { status: 200, body: { id: "2", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  const base = {
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "user_action",
    threadId: "t",
  } as const;

  await recordAnnotation(base);
  await recordAnnotation(base);

  expect(calls).toHaveLength(2);
  expect(calls[0]!.body!.clientEventId).not.toBe(calls[1]!.body!.clientEventId);
  expect(calls[0]!.body).not.toHaveProperty("userId");
  expect(calls[1]!.body).not.toHaveProperty("userId");
});

it("forwards the caller-supplied occurredAt in the body", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "user_action",
    threadId: "t",
    occurredAt: "2026-01-01T00:00:00.000Z",
  });

  expect(calls[0]!.body!.occurredAt).toBe("2026-01-01T00:00:00.000Z");
  expect(calls[0]!.body).not.toHaveProperty("userId");
});

it("omits occurredAt from the body when not supplied", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "user_action",
    threadId: "t",
  });

  expect(calls[0]!.body).not.toHaveProperty("occurredAt");
  expect(calls[0]!.body).not.toHaveProperty("userId");
});

it("includes Content-Type and forwards customer headers", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: { "X-Customer": "tenant-abc" },
    type: "user_action",
    threadId: "t",
  });

  const headers = calls[0]!.init?.headers as Record<string, string>;
  expect(headers["Content-Type"]).toBe("application/json");
  expect(headers["X-Customer"]).toBe("tenant-abc");
  expect(calls[0]!.body).not.toHaveProperty("userId");
});

it("propagates fetch rejections (network error) to the caller", async () => {
  globalThis.fetch = vi
    .fn()
    .mockRejectedValue(
      new TypeError("network request failed"),
    ) as unknown as typeof globalThis.fetch;

  await expect(
    recordAnnotation({
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "t",
    }),
  ).rejects.toThrow(/network request failed/);
});

it("throws with the HTTP status when the response is not ok", async () => {
  const { fetch } = mockFetch([{ status: 422, body: { error: "bad input" } }]);
  globalThis.fetch = fetch;

  await expect(
    recordAnnotation({
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "t",
    }),
  ).rejects.toThrow(/422/);
});

it("accepts undefined payload and omits it from the body", async () => {
  const { calls, fetch } = mockFetch([
    { status: 200, body: { id: "1", duplicate: false } },
  ]);
  globalThis.fetch = fetch;

  await recordAnnotation({
    runtimeUrl: "https://bff.example.com/api/copilotkit",
    headers: {},
    type: "user_action",
    threadId: "t",
    payload: undefined,
  });

  expect(calls[0]!.body).not.toHaveProperty("payload");
  expect(calls[0]!.body).not.toHaveProperty("userId");
});

// ── F1 guard: empty body ───────────────────────────────────────────────────────

it("throws a contextual error when the runtime returns 200 with an empty body", async () => {
  // Return a Response whose body is the empty string (no JSON).
  const fakeFetch = vi.fn(
    async () =>
      new Response("", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;

  await expect(
    recordAnnotation({
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "t",
    }),
  ).rejects.toThrow(/empty body/);
});

it("throws a contextual error when the runtime returns 200 with a non-JSON body", async () => {
  // Return a Response whose body is non-JSON text.
  const fakeFetch = vi.fn(
    async () =>
      new Response("OK", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      }),
  );
  globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;

  await expect(
    recordAnnotation({
      runtimeUrl: "https://bff.example.com/api/copilotkit",
      headers: {},
      type: "user_action",
      threadId: "t",
    }),
  ).rejects.toThrow(/non-JSON body/);
});
