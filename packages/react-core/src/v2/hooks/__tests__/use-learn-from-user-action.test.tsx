import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopilotKit } from "../../context";
import { useLearnFromUserAction } from "../use-learn-from-user-action";

vi.mock("../../context", () => ({
  useCopilotKit: vi.fn(),
}));

// setupTests.ts mocks `randomUUID` from `@copilotkit/shared` to return a
// constant for thread-id tests. This hook's clientEventId tests need
// distinct values per call, so override the mock locally with a counter.
let uuidCounter = 0;
vi.mock("@copilotkit/shared", async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>("@copilotkit/shared");
  return {
    ...actual,
    randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
  };
});

const mockUseCopilotKit = useCopilotKit as ReturnType<typeof vi.fn>;

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

const installCopilotKit = (
  overrides: {
    runtimeUrl?: string | null;
    headers?: Record<string, string>;
  } = {},
) => {
  mockUseCopilotKit.mockReturnValue({
    copilotkit: {
      runtimeUrl:
        overrides.runtimeUrl === undefined
          ? "https://bff.example.com/api/copilotkit"
          : overrides.runtimeUrl,
      headers: overrides.headers,
    },
  });
};

describe("useLearnFromUserAction", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    uuidCounter = 0;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("POSTs to ${runtimeUrl}/annotate with type:user_action, payload, and returns the platform result", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "42", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    const recorded = await result.current({
      threadId: "thread-1",
      title: "Renamed project",
      data: { previous: { name: "Foo" }, next: { name: "Bar" } },
    });

    expect(recorded).toEqual({ id: "42", duplicate: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://bff.example.com/api/copilotkit/annotate",
    );
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.body).toMatchObject({
      type: "user_action",
      threadId: "thread-1",
      payload: {
        title: "Renamed project",
        data: { previous: { name: "Foo" }, next: { name: "Bar" } },
      },
    });
    expect(typeof calls[0]!.body!.clientEventId).toBe("string");
    expect((calls[0]!.body!.clientEventId as string).length).toBeGreaterThan(0);
  });

  it("forwards the caller's clientEventId verbatim when supplied", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "7", duplicate: true } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({
      threadId: "thread-1",
      title: "X",
      clientEventId: "stable-id-123",
    });

    expect(calls[0]!.body!.clientEventId).toBe("stable-id-123");
  });

  it("auto-generates a new clientEventId per call when not supplied", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
      { status: 200, body: { id: "2", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({ threadId: "t", title: "x" });
    await result.current({ threadId: "t", title: "x" });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.body!.clientEventId).not.toBe(
      calls[1]!.body!.clientEventId,
    );
  });

  it("includes the customer headers from copilotkit.headers", async () => {
    installCopilotKit({ headers: { "X-Customer": "abc" } });
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({ threadId: "t", title: "x" });

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["X-Customer"]).toBe("abc");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws when runtimeUrl is not configured", async () => {
    installCopilotKit({ runtimeUrl: null });
    const { fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await expect(result.current({ threadId: "t", title: "x" })).rejects.toThrow(
      /runtimeUrl is not configured/,
    );
  });

  it("propagates fetch rejections (network error) to the caller", async () => {
    installCopilotKit();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("network request failed"),
      ) as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await expect(result.current({ threadId: "t", title: "x" })).rejects.toThrow(
      /network request failed/,
    );
  });

  it("throws with the platform status when the request fails", async () => {
    installCopilotKit();
    const { fetch } = mockFetch([{ status: 400, body: { error: "bad" } }]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await expect(result.current({ threadId: "t", title: "x" })).rejects.toThrow(
      /400/,
    );
  });

  it("omits optional fields from the request body when absent", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({
      threadId: "t",
      title: "x",
    });

    // Top-level body should not contain these removed fields
    expect(calls[0]!.body).not.toHaveProperty("learningContainer");
    expect(calls[0]!.body).not.toHaveProperty("metadata");
    expect(calls[0]!.body).not.toHaveProperty("occurredAt");
    // Payload should not have description or data when absent
    const payload = calls[0]!.body!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("description");
    expect(payload).not.toHaveProperty("data");
  });

  it("nests title, description, and data inside payload", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({
      threadId: "t",
      title: "My title",
      description: "Some description",
      data: { key: "value" },
    });

    expect(calls[0]!.body!.payload).toEqual({
      title: "My title",
      description: "Some description",
      data: { key: "value" },
    });
  });

  it("does not include learningContainer or metadata in the request body", async () => {
    // learningContainer and metadata are removed from the input type entirely.
    // Verify they are never present in the outgoing request body.
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({ threadId: "t", title: "x" });

    expect(calls[0]!.body).not.toHaveProperty("learningContainer");
    expect(calls[0]!.body).not.toHaveProperty("metadata");
    const payload = calls[0]!.body!.payload as
      | Record<string, unknown>
      | undefined;
    if (payload) {
      expect(payload).not.toHaveProperty("learningContainer");
      expect(payload).not.toHaveProperty("metadata");
    }
  });

  it("forwards occurredAt in the request body when provided", async () => {
    installCopilotKit();
    const { calls, fetch } = mockFetch([
      { status: 200, body: { id: "1", duplicate: false } },
    ]);
    globalThis.fetch = fetch;

    const { result } = renderHook(() => useLearnFromUserAction());
    await result.current({
      threadId: "t",
      title: "x",
      occurredAt: "2024-01-01T00:00:00Z",
    });

    expect(calls[0]!.body!.occurredAt).toBe("2024-01-01T00:00:00Z");
  });
});
