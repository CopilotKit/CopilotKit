import { expect, test, vi } from "vitest";
import { isChannelsTerminalBatchingEnabled } from "./operations-feature-flags.js";

const FLAG_KEY = "channels-terminal-batching";
const OPERATIONS_TOKEN = "phc_XZdymVYjrph9Mi0xZYGNyCKexxgblXRR1jMENCtdz5Q";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("requests the Operations flag for the Intelligence project identity", async () => {
  const fetch = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse({
        flags: {
          "unrelated-flag": { key: "unrelated-flag", enabled: false },
          [FLAG_KEY]: { key: FLAG_KEY, enabled: true },
        },
      }),
  );

  await expect(isChannelsTerminalBatchingEnabled(123, fetch)).resolves.toBe(
    true,
  );
  expect(fetch).toHaveBeenCalledOnce();

  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe("https://eu.i.posthog.com/flags/?v=2");
  expect(init).toEqual({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: expect.any(AbortSignal),
    body: JSON.stringify({
      token: OPERATIONS_TOKEN,
      distinct_id: "intelligence-project:123",
      geoip_disable: true,
    }),
  });
});

test("returns false when the target flag is explicitly disabled", async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      flags: {
        [FLAG_KEY]: { key: FLAG_KEY, enabled: false },
      },
    }),
  ) as typeof globalThis.fetch;

  await expect(isChannelsTerminalBatchingEnabled(123, fetch)).resolves.toBe(
    false,
  );
});

test("returns false for an HTTP error", async () => {
  const fetch = vi.fn(async () => jsonResponse({ error: "unavailable" }, 503));

  await expect(
    isChannelsTerminalBatchingEnabled(123, fetch as typeof globalThis.fetch),
  ).resolves.toBe(false);
});

test("returns false for a network failure", async () => {
  const fetch = vi.fn(async () => {
    throw new Error("network unavailable");
  });
  const log = vi.fn();

  await expect(
    isChannelsTerminalBatchingEnabled(
      123,
      fetch as typeof globalThis.fetch,
      log,
    ),
  ).resolves.toBe(false);
  expect(log).toHaveBeenCalledWith(
    "channels terminal batching flag evaluation failed; using streaming",
    { reason: "request_failed" },
  );
});

test("aborts a request after 3 seconds and returns false", async () => {
  vi.useFakeTimers();
  try {
    const fetch = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const settled = vi.fn();

    const evaluation = isChannelsTerminalBatchingEnabled(123, fetch);
    void evaluation.then(settled);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(settled).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith(false);
    await expect(evaluation).resolves.toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

test("returns false for malformed JSON", async () => {
  const fetch = vi.fn(
    async () =>
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );

  await expect(
    isChannelsTerminalBatchingEnabled(123, fetch as typeof globalThis.fetch),
  ).resolves.toBe(false);
});

test.each([
  ["a non-record body", null],
  ["a non-record flags value", { flags: [] }],
  ["a non-record target flag", { flags: { [FLAG_KEY]: null } }],
])("returns false for %s", async (_description, body) => {
  const fetch = vi.fn(async () => jsonResponse(body));

  await expect(
    isChannelsTerminalBatchingEnabled(123, fetch as typeof globalThis.fetch),
  ).resolves.toBe(false);
});

test("returns false when the target flag is missing", async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      flags: {
        "unrelated-flag": { key: "unrelated-flag", enabled: true },
      },
    }),
  ) as typeof globalThis.fetch;

  await expect(isChannelsTerminalBatchingEnabled(123, fetch)).resolves.toBe(
    false,
  );
});

test("returns false when enabled is not a boolean", async () => {
  const fetch = vi.fn(async () =>
    jsonResponse({
      flags: {
        [FLAG_KEY]: { key: FLAG_KEY, enabled: "true" },
      },
    }),
  ) as typeof globalThis.fetch;

  await expect(isChannelsTerminalBatchingEnabled(123, fetch)).resolves.toBe(
    false,
  );
});
