/**
 * Deferred runtime connection (#5801).
 *
 * `CopilotKitProvider` constructs the core during React's render phase, and
 * React can start-and-discard renders (concurrent rendering, Suspense,
 * StrictMode). When the constructor fires the `/info` request synchronously,
 * every discarded-and-recreated core issues its own request — a single page
 * load was observed firing 70-80 `/info` requests.
 *
 * The fix separates construction (pure) from connection (network I/O):
 * `deferInitialConnection` lets the constructor set the runtime config WITHOUT
 * fetching, and `connect()` — driven from a commit-phase effect — starts the
 * single connection for the surviving instance. `connect()` is idempotent so
 * StrictMode's double-invoked effect collapses to one request.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CopilotKitCore } from "../core";

const RUNTIME_URL = "https://runtime.example/rest";
const infoResponse = { version: "1.0.0", agents: {} };

describe("CopilotKitCore — deferred runtime connection (#5801)", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(infoResponse), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  const infoCalls = () =>
    fetchMock.mock.calls.filter(([u]) => String(u).includes("/info"));

  it("does not fetch /info from the constructor when deferInitialConnection is set", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    expect(core.runtimeUrl).toBe(RUNTIME_URL);
    // Wait a macrotask — a constructor-initiated fetch fires after an internal
    // await, so a microtask wait would miss it and pass falsely.
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(0);
  });

  it("still exposes runtimeUrl synchronously when deferred", () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    expect(core.runtimeUrl).toBe(RUNTIME_URL);
  });

  it("connect() triggers exactly one /info fetch after a deferred construct", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    core.connect();
    await vi.waitFor(() => expect(infoCalls().length).toBe(1));
    expect(infoCalls()[0]?.[0]).toBe(`${RUNTIME_URL}/info`);
  });

  it("connect() is idempotent — repeated calls collapse to one /info fetch (StrictMode double-invoke)", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    core.connect();
    core.connect();
    core.connect();
    await vi.waitFor(() => expect(infoCalls().length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(1);
  });

  it("without deferInitialConnection the constructor still connects (backward compatible)", async () => {
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
    });
    expect(core.runtimeUrl).toBe(RUNTIME_URL);
    await vi.waitFor(() => expect(infoCalls().length).toBe(1));
  });

  it("orphaned cores that never connect() fire zero /info; only the committed one fetches", async () => {
    // Models React discarding in-progress renders: each attempt constructs a
    // core, but only the committed instance reaches the connect() effect.
    const orphans: CopilotKitCore[] = [];
    for (let i = 0; i < 5; i++) {
      orphans.push(
        new CopilotKitCore({
          runtimeUrl: RUNTIME_URL,
          runtimeTransport: "rest",
          deferInitialConnection: true,
        }),
      );
    }
    expect(orphans).toHaveLength(5);
    const committed = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    committed.connect();

    await vi.waitFor(() => expect(infoCalls().length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(1);
  });

  it("de-dupes concurrent same-target updateRuntimeConnection calls into one /info (in-flight guard)", async () => {
    // A url + transport change arriving together must not fire two /info.
    const core = new CopilotKitCore({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    core.setRuntimeTransport("rest");
    core.connect();
    core.connect();
    await vi.waitFor(() => expect(infoCalls().length).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(infoCalls().length).toBe(1);
  });
});
