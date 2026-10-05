import { expect, test, vi } from "vitest";
import { CopilotKitIntelligence, PlatformRequestError } from "../client";

const ACTIVE_ENTITLEMENTS_TRANSPORT = {
  organizationId: "org-private",
  active: true,
  source: "managedOrgSubscription",
  features: { threads: true },
  limits: {},
} as const;

/** A fetch that never answers until its request signal aborts. */
function stalledFetch(
  _input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** A fetch that answers with an active entitlement after `delayMs`. */
function slowFetch(delayMs: number) {
  return (_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(
        () => resolve(Response.json(ACTIVE_ENTITLEMENTS_TRANSPORT)),
        delayMs,
      );
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
}

/** Install fake timers and a fetch mock, and return a client plus cleanup. */
function setup() {
  vi.useFakeTimers();
  const fetchMock = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const client = new CopilotKitIntelligence({
    apiKey: "test-api-key",
    apiUrl: "https://runtime.example",
    wsUrl: "wss://runtime.example",
  });
  /** Start a lookup and record its outcome without awaiting it. */
  function start() {
    const state: { settled: boolean; outcome?: unknown } = { settled: false };
    const done = client.getRuntimeEntitlements().then(
      (response) => {
        state.settled = true;
        state.outcome = response;
      },
      (error: unknown) => {
        state.settled = true;
        state.outcome = error;
      },
    );
    return { state, done };
  }
  return {
    fetchMock,
    start,
    async teardown() {
      await vi.runAllTimersAsync();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}

test("accepts an entitlement response slower than 1.5 s on the first attempt", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock.mockImplementation(slowFetch(2_000));
  try {
    const { state, done } = start();
    await vi.advanceTimersByTimeAsync(2_000);
    await done;

    expect(state.outcome).toMatchObject({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledOnce();
  } finally {
    await teardown();
  }
});

test("retries once when the first attempt times out", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock
    .mockImplementationOnce(stalledFetch)
    .mockImplementationOnce(slowFetch(100));
  try {
    const { state, done } = start();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(100);
    await done;
    expect(state.outcome).toMatchObject({ status: "ready" });
  } finally {
    await teardown();
  }
});

test("retries once on a retryable status and reports the last failure", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(null, { status: 503 })),
  );
  try {
    const { state, done } = start();
    await done;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.outcome).toBeInstanceOf(PlatformRequestError);
    expect(state.outcome).toMatchObject({ status: 503, retryable: true });
  } finally {
    await teardown();
  }
});

test("retries once after a network failure", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock
    .mockRejectedValueOnce(new Error("socket hang up"))
    .mockImplementationOnce(() =>
      Promise.resolve(Response.json(ACTIVE_ENTITLEMENTS_TRANSPORT)),
    );
  try {
    const { state, done } = start();
    await done;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.outcome).toMatchObject({ status: "ready" });
  } finally {
    await teardown();
  }
});

test.each([401, 403, 404])(
  "does not retry a nonretryable %i status",
  async (status) => {
    const { fetchMock, start, teardown } = setup();
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(null, { status })),
    );
    try {
      const { state, done } = start();
      await done;

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(state.outcome).toMatchObject({ status, retryable: false });
    } finally {
      await teardown();
    }
  },
);

test("does not retry a malformed entitlement response", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response("not-json", { status: 200 })),
  );
  try {
    const { state, done } = start();
    await done;

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(state.outcome).toMatchObject({ status: 502, retryable: false });
  } finally {
    await teardown();
  }
});

test("bounds both attempts together below the Core info timeout", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock.mockImplementation(stalledFetch);
  try {
    const { state } = start();
    await vi.advanceTimersByTimeAsync(3_999);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.outcome).toMatchObject({
      message: "Runtime entitlement request timed out",
      status: 504,
      retryable: true,
    });
  } finally {
    await teardown();
  }
});

test("gives the retry only the time left in the budget", async () => {
  const { fetchMock, start, teardown } = setup();
  fetchMock
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) =>
          setTimeout(() => resolve(new Response(null, { status: 503 })), 2_000),
        ),
    )
    .mockImplementation(stalledFetch);
  try {
    const { state } = start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(state.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(state.outcome).toMatchObject({ status: 504, retryable: true });
  } finally {
    await teardown();
  }
});
