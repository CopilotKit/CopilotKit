import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } from "../core";
import { ɵoverlayCoreHeaders } from "../core/header-source";
import { RUNTIME_REQUEST_WATCHDOG_MS } from "../utils/runtime-request";

const ok = () =>
  Promise.resolve(
    new Response(JSON.stringify({ version: "1.0.0", agents: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );

function authOf(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("authorization");
}

/** Runs `fn` with a browser-like `window` present, then restores the prior global. */
async function withBrowserWindow<T>(fn: () => Promise<T>): Promise<T> {
  const originalWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = {};
  try {
    return await fn();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  }
}

describe("ɵoverlayCoreHeaders", () => {
  it("core beats an agent's own header, but a site's Content-Type and Accept win", () => {
    const out = ɵoverlayCoreHeaders(
      {
        Authorization: "agent-own",
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      { Authorization: "core", "Content-Type": "text/plain", Accept: "*/*" },
    ) as Record<string, string>;
    expect(out).toEqual({
      Authorization: "core",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    });
  });

  it("overlay replaces a differently-cased existing key", () => {
    const out = ɵoverlayCoreHeaders(
      { Authorization: "old" },
      { authorization: "new" },
    ) as Record<string, string>;
    expect(out).toEqual({ authorization: "new" });
  });

  it("keeps a Headers instance as Headers", () => {
    const out = ɵoverlayCoreHeaders(new Headers({ A: "1" }), { B: "2" });
    expect(out).toBeInstanceOf(Headers);
    expect((out as Headers).get("b")).toBe("2");
  });
});

describe("ɵruntimeFetch", () => {
  const realFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(ok);
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("sends the builder's current token, not the one from construction", async () => {
    let token = "t1";
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: () => ({ Authorization: token }),
    });
    token = "t2";
    await core.ɵruntimeFetch("https://rt.example/threads", { headers: {} });
    expect(authOf(fetchMock.mock.calls.at(-1)![1])).toBe("t2");
  });

  it("awaits an async builder", async () => {
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: async () => ({ Authorization: "async" }),
    });
    await core.ɵruntimeFetch("https://rt.example/threads");
    expect(authOf(fetchMock.mock.calls.at(-1)![1])).toBe("async");
  });

  it("a builder failure rejects without sending", async () => {
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: async () => {
        throw new Error("x");
      },
    });
    await expect(
      core.ɵruntimeFetch("https://rt.example/threads"),
    ).rejects.toThrow("Failed to resolve request headers");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an aborted signal aborts the wait for the builder", async () => {
    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: () => new Promise(() => {}),
    });
    const controller = new AbortController();
    const pending = core.ɵruntimeFetch("https://rt.example/threads", {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a slow builder does not trip the runtime watchdog", () =>
    withBrowserWindow(async () => {
      // Connect for real first, so the watchdog's failure path (a
      // reachability probe against a Connected runtime) is actually
      // reachable — a core that never connects short-circuits
      // `handleRuntimeRequestOutcome` before it can observe anything, which
      // would make this test pass vacuously.
      const core = new CopilotKitCore({
        runtimeUrl: "https://rt.example",
        runtimeTransport: "rest",
      });
      await vi.waitFor(() =>
        expect(core.runtimeConnectionStatus).toBe(
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        ),
      );
      fetchMock.mockClear();

      vi.useFakeTimers();
      try {
        let release!: (v: Record<string, string>) => void;
        core.setHeaders(() => new Promise((r) => (release = r)));
        const statuses: string[] = [];
        core.subscribe({
          onRuntimeConnectionStatusChanged: ({ status }) =>
            void statuses.push(status),
        });
        // Take the timer-count baseline right before issuing the request:
        // fetchRuntimeInfo now also awaits the same pending builder (#1937),
        // so a reachability-probe fetch firing (or not) while the builder is
        // pending no longer distinguishes correct from buggy ordering — a
        // probe triggered by a wrongly-armed watchdog would itself stall on
        // `resolveHeaders()` and never reach `fetch`. Checking that the
        // watchdog's `setTimeout` was never scheduled in the first place is
        // the direct, order-sensitive check.
        const timersBeforeRequest = vi.getTimerCount();
        const pending = core.ɵruntimeFetch("https://rt.example/threads");
        // While only the header builder is pending, the watchdog must not
        // have been armed yet — no new timer scheduled.
        expect(vi.getTimerCount()).toBe(timersBeforeRequest);
        await vi.advanceTimersByTimeAsync(RUNTIME_REQUEST_WATCHDOG_MS * 2);
        release({ Authorization: "late" });
        await pending;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(statuses).not.toContain(
          CopilotKitCoreRuntimeConnectionStatus.Error,
        );
      } finally {
        vi.useRealTimers();
      }
    }));

  it("applies headers before the single-route rewrite", () =>
    withBrowserWindow(async () => {
      // The rewrite only fires when `/info` advertises the single-route
      // resource capability. Without this, the request would pass through
      // unchanged, and the test would prove nothing about ordering.
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: "1.0.0",
              agents: {},
              singleRoute: {
                resourceOperations: true,
                threadEndpoints: {
                  list: true,
                  inspect: true,
                  mutations: true,
                  realtimeMetadata: true,
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      );
      const core = new CopilotKitCore({
        runtimeUrl: "https://rt.example/api",
        runtimeTransport: "single",
        headers: () => ({ Authorization: "single" }),
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      fetchMock.mockClear();

      await core.ɵruntimeFetch("https://rt.example/api/threads?agentId=a", {
        headers: { Accept: "application/json" },
      });

      const [rewrittenInput, rewrittenInit] = fetchMock.mock.calls.at(-1)!;
      // The single-route rewrite always targets the mounted endpoint itself,
      // not the resource path — this confirms the rewrite actually ran.
      expect(String(rewrittenInput)).toBe("https://rt.example/api");
      expect(authOf(rewrittenInit)).toBe("single");
      const body = JSON.parse((rewrittenInit as RequestInit).body as string);
      expect(body).toMatchObject({
        method: "resource/request",
        params: { path: "/threads?agentId=a", httpMethod: "GET" },
      });
    }));
});
