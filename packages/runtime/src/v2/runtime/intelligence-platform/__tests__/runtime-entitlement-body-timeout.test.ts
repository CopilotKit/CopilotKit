import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence, PlatformRequestError } from "../client";

/** Create an isolated fetch whose headers arrive before its stalled body. */
function setup() {
  vi.useFakeTimers();
  const fetchMock = vi.fn(
    (...[_input, init]: Parameters<typeof globalThis.fetch>) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener(
            "abort",
            () =>
              controller.error(
                new DOMException("private-body-detail", "AbortError"),
              ),
            { once: true },
          );
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  const client = new CopilotKitIntelligence({
    apiKey: "fixture-key",
    apiUrl: "https://platform.test",
    wsUrl: "wss://platform.test",
  });
  return {
    client,
    fetchMock,
    dispose() {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}

test("a stalled entitlement body returns a retryable timeout, including cached failures", async () => {
  const { client, fetchMock, dispose } = setup();
  try {
    const request = client
      .getRuntimeEntitlements()
      .catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1500);
    const error = await request;

    expect(error).toBeInstanceOf(PlatformRequestError);
    if (!(error instanceof PlatformRequestError))
      throw new Error("Expected a typed timeout");
    expect(error.status).toBe(504);
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Runtime entitlement request timed out");
    expect(error.message).not.toContain("private-body-detail");
    const cached = await client
      .getRuntimeEntitlements()
      .catch((failure: unknown) => failure);
    expect(cached).not.toBe(error);
    expect(cached).toMatchObject({ status: 504, retryable: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    dispose();
  }
});

test("malformed entitlement JSON remains a nonretryable response error", async () => {
  const { client, fetchMock, dispose } = setup();
  try {
    fetchMock.mockResolvedValue(
      new Response("private-invalid-json", { status: 200 }),
    );

    const error = await client
      .getRuntimeEntitlements()
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(PlatformRequestError);
    expect(error).toMatchObject({ status: 502, retryable: false });
    if (!(error instanceof PlatformRequestError))
      throw new Error("Expected a typed schema error");
    expect(error.message).not.toContain("private-invalid-json");
  } finally {
    dispose();
  }
});
