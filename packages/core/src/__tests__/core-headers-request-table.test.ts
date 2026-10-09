/**
 * #1937 request-table: proves every core-owned request type resolves headers
 * fresh at send time, not from a snapshot captured earlier.
 *
 * Each row below builds its own `CopilotKitCore` (and, for the specialized
 * rows, its own store/agent) with a headers builder, changes the token the
 * builder returns, triggers the request, and returns the `Authorization`
 * value the request actually carried. `vi.mock("phoenix")` is file-wide
 * because the thread store, memory store, and `IntelligenceAgent` all import
 * the real `phoenix` package transitively; the mock keeps every row from
 * needing a live WebSocket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import type { AbstractAgent } from "@ag-ui/client";
import type { MockChannel } from "./test-utils";
import {
  MockAgent,
  MockSocket,
  createMessage,
  createSuggestionsConfig,
  waitForCondition,
} from "./test-utils";

vi.mock("phoenix", () => ({ Socket: MockSocket }));

// Must come after vi.mock so phoenix is mocked when these modules load.
const { CopilotKitCore, CopilotKitCoreRuntimeConnectionStatus } =
  await import("../core");
const { ɵcreateThreadStore } = await import("../threads");
const { IntelligenceAgent } = await import("../intelligence-agent");

type IntelligenceAgentInstance = InstanceType<typeof IntelligenceAgent>;

interface Call {
  url: string;
  auth: string | null;
}

function authOf(init?: RequestInit): string | null {
  return new Headers(init?.headers).get("authorization");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const encoder = new TextEncoder();
function sseResponse(events: object[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      const payload = events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

/** A generic `/info` + 401-everything-else fetch, recording every call. */
function recordingFetch(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, auth: authOf(init) });
    if (url.endsWith("/info")) {
      return jsonResponse({
        version: "1.0.0",
        agents: { default: { name: "default", description: "" } },
      });
    }
    return new Response("no", { status: 401 });
  });
}

/** Runs `fn` with a browser-like `window` present, restoring the prior global after. */
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

// ---------------------------------------------------------------------------
// IntelligenceAgent mid-run-reconnect helpers (mirrors intelligence-agent.test.ts)
// ---------------------------------------------------------------------------

function runtimeCredentials(joinToken: string) {
  return {
    threadId: "thread-1",
    runId: "run-1",
    joinToken,
    realtime: {
      clientUrl: "ws://localhost:4000/client",
      topic: "thread:thread-1",
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

interface IntelligenceAgentTestAccess {
  activeChannel: MockChannel | null;
  socket: MockSocket | null;
  threadId: string | undefined;
  connect(input: unknown): { subscribe(observer: unknown): void };
}

function testAccess(
  agent: IntelligenceAgentInstance,
): IntelligenceAgentTestAccess {
  return agent as unknown as IntelligenceAgentTestAccess;
}

async function waitForSocket(
  agent: IntelligenceAgentInstance,
  attempts = 5,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    await flushAsyncWork();
    if (testAccess(agent).socket && testAccess(agent).activeChannel) {
      return;
    }
  }
}

const defaultInput = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
};

// ---------------------------------------------------------------------------
// Row implementations. Each returns the `Authorization` value the target
// request carried (or `null`/`undefined` if the request never happened).
// ---------------------------------------------------------------------------

async function infoDiscoveryRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, auth: authOf(init) });
        return jsonResponse({ version: "1.0.0", agents: {} });
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      headers: () => ({ Authorization: token }),
    });
    token = "fresh";
    core.setRuntimeUrl(undefined);
    core.setRuntimeUrl("http://rt.test/api");

    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/info"))).toBe(true),
    );
    for (let i = calls.length - 1; i >= 0; i--) {
      if (calls[i]!.url.endsWith("/info")) {
        return calls[i]!.auth;
      }
    }
    return undefined;
  });
}

async function threadsListRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, auth: authOf(init) });
        if (url.includes("/threads?")) {
          return jsonResponse({ threads: [] });
        }
        // No real joinToken here — the credentials fetch fails harmlessly and
        // no phoenix socket is ever created, which is all this row needs.
        return jsonResponse({});
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: () => ({ Authorization: token }),
    });
    const store = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    try {
      store.start();
      store.setContext({
        runtimeUrl: "https://rt.test/api",
        agentId: "default",
      });
      await vi.waitFor(() =>
        expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true),
      );
      calls.length = 0;
      token = "fresh";
      store.refetchThreads();
      await vi.waitFor(() =>
        expect(calls.some((c) => c.url.includes("/threads?"))).toBe(true),
      );
      return calls.find((c) => c.url.includes("/threads?"))?.auth;
    } finally {
      store.stop();
    }
  });
}

async function memoryStoreRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, auth: authOf(init) });
        if (url.endsWith("/info")) {
          return jsonResponse({
            version: "1.0.0",
            agents: {},
            mode: "intelligence",
            intelligence: { wsUrl: "wss://gw.example.com/client" },
          });
        }
        if (url.includes("/memories") && !url.includes("subscribe")) {
          return jsonResponse({ memories: [] });
        }
        // Malformed subscribe response — no joinToken/joinCode, so no socket
        // is ever created.
        return jsonResponse({});
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://rt.test/api",
      runtimeTransport: "rest",
      headers: () => ({ Authorization: token }),
    });
    await vi.waitFor(() =>
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      ),
    );
    const store = core.getMemoryStore();
    await vi.waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes("/memories") && !c.url.includes("subscribe"),
        ),
      ).toBe(true),
    );
    calls.length = 0;
    token = "fresh";
    await store.refresh();
    return calls.find(
      (c) => c.url.includes("/memories") && !c.url.includes("subscribe"),
    )?.auth;
  });
}

async function runtimeRunRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = recordingFetch(calls) as unknown as typeof fetch;
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => ({ Authorization: token }),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    token = "fresh";
    await core.runAgent({ agent: core.getAgent("default")! }).catch(() => {});
    return calls.find((c) => c.url.includes("/run"))?.auth;
  });
}

async function runtimeConnectRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = recordingFetch(calls) as unknown as typeof fetch;
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => ({ Authorization: token }),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    token = "fresh";
    await core
      .connectAgent({ agent: core.getAgent("default")! } as never)
      .catch(() => {});
    return calls.find((c) => c.url.includes("/connect"))?.auth;
  });
}

async function stopRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = recordingFetch(calls) as unknown as typeof fetch;
    const core = new CopilotKitCore({
      runtimeUrl: "http://rt.test/api",
      headers: () => ({ Authorization: token }),
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    const agent = core.getAgent("default")!;
    agent.threadId = "thread-1";
    token = "fresh";
    agent.abortRun();
    await waitForCondition(() => calls.some((c) => c.url.includes("/stop/")));
    return calls.find((c) => c.url.includes("/stop/"))?.auth;
  });
}

async function statelessSuggestRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const suggestCalls: Call[] = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/suggest")) {
          suggestCalls.push({ url, auth: authOf(init) });
          return sseResponse([]);
        }
        return jsonResponse({
          version: "1.0.0",
          mode: "sse",
          agents: {},
          suggestions: true,
        });
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers: () => ({ Authorization: token }),
    });
    await waitForCondition(() => core.suggestions === true);

    const providerAgent = new MockAgent({ agentId: "default" });
    const consumerAgent = new MockAgent({
      agentId: "consumer",
      messages: [createMessage({ content: "hi" })],
    });
    core.addAgent__unsafe_dev_only({
      id: "default",
      agent: providerAgent as unknown as AbstractAgent,
    });
    core.addAgent__unsafe_dev_only({
      id: "consumer",
      agent: consumerAgent as unknown as AbstractAgent,
    });
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    token = "fresh";
    core.reloadSuggestions("consumer");

    await vi.waitFor(() => expect(suggestCalls.length).toBeGreaterThan(0));
    return suggestCalls[0]?.auth;
  });
}

async function intelligenceReconnectRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: "", auth: authOf(init) });
        return jsonResponse(runtimeCredentials(`jt-${calls.length}`));
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      deferInitialConnection: true,
      headers: () => ({ Authorization: token }),
    });

    const agent = new IntelligenceAgent({
      url: "ws://localhost:4000/client",
      runtimeUrl: "http://localhost:4000",
      agentId: "my-agent",
      fetch: core.ɵruntimeFetch,
    });
    const access = testAccess(agent);
    access.threadId = "thread-1";

    access.connect(defaultInput).subscribe({ next: () => {}, error: () => {} });
    await waitForSocket(agent);
    access.activeChannel!.triggerJoin("ok");

    // The token changes AFTER the first join — the mid-run reconnect below
    // must pick up this new value, not the one current when connect() was
    // first called.
    token = "fresh";

    for (let i = 0; i < 5; i++) {
      access.socket!.triggerError(new Error("network failure"));
    }
    await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    return calls[1]?.auth;
  });
}

async function inspectorMetadataRow(): Promise<string | null | undefined> {
  return withBrowserWindow(async () => {
    let token = "stale";
    const calls: Call[] = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, auth: authOf(init) });
        if (url.endsWith("/info")) {
          return jsonResponse({
            version: "1.0.0",
            agents: {},
            inspectorMetadata: true,
          });
        }
        // /inspector-metadata
        return jsonResponse({
          schemaVersion: 1,
          plan: { code: "free", label: "Free" },
          usage: { used: 0, limit: { kind: "finite", value: 1 } },
        });
      },
    ) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://rt.test/api",
      headers: () => ({ Authorization: token }),
    });
    await vi.waitFor(() =>
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      ),
    );
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/inspector-metadata"))).toBe(
        true,
      ),
    );
    calls.length = 0;
    token = "fresh";
    await core.refreshInspectorMetadata();
    return calls.find((c) => c.url.endsWith("/inspector-metadata"))?.auth;
  });
}

async function clonedHttpAgentSuggestRow(): Promise<string | null | undefined> {
  let token = "stale";
  const agentCalls: Call[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    agentCalls.push({ url, auth: authOf(init) });
    return sseResponse([]);
  }) as unknown as typeof fetch;

  const core = new CopilotKitCore({
    headers: () => ({ Authorization: token }),
  });
  const providerAgent = new HttpAgent({
    agentId: "default",
    url: "https://agent.example/run",
  });
  const consumerAgent = new MockAgent({
    agentId: "consumer",
    messages: [createMessage({ content: "hi" })],
  });
  core.addAgent__unsafe_dev_only({ id: "default", agent: providerAgent });
  core.addAgent__unsafe_dev_only({
    id: "consumer",
    agent: consumerAgent as unknown as AbstractAgent,
  });
  // A previous run left the stale token on the provider agent, which a
  // clone copies.
  await core.resolveHeaders();
  core.applyHeadersToAgent(providerAgent);
  expect(providerAgent.headers.Authorization).toBe("stale");

  core.addSuggestionsConfig(
    createSuggestionsConfig({
      providerAgentId: "default",
      consumerAgentId: "consumer",
    }),
  );
  token = "fresh";
  core.reloadSuggestions("consumer");

  await vi.waitFor(() => expect(agentCalls.length).toBeGreaterThan(0));
  return agentCalls[0]?.auth;
}

async function trajectoryConnectRow(): Promise<string | null | undefined> {
  let token = "stale";
  const calls: Call[] = [];
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("location", new URL("https://app.invalid/"));
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("document", { title: "Synthetic app", referrer: "" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, auth: authOf(init) });
      return new Response("no", { status: 401 });
    }),
  );
  try {
    const core = new CopilotKitCore({
      runtimeUrl: "https://rt.test/api",
      runtimeTransport: "single",
      deferInitialConnection: true,
      headers: () => ({ Authorization: token }),
      learning: {
        capture: {
          clicks: false,
          navigation: false,
          inputs: false,
          network: false,
        },
      },
    });
    // An earlier request left the stale token as the last resolved value.
    await core.resolveHeaders();
    token = "fresh";
    await core.startTrajectory({ trajectoryId: "trajectory-1" });
    core.stopTrajectory();
    return calls[0]?.auth;
  } finally {
    vi.unstubAllGlobals();
  }
}

const rows: Array<[string, () => Promise<string | null | undefined>]> = [
  ["/info discovery", infoDiscoveryRow],
  ["inspector metadata", inspectorMetadataRow],
  ["threads list", threadsListRow],
  ["memory store", memoryStoreRow],
  ["runtime run", runtimeRunRow],
  ["runtime connect", runtimeConnectRow],
  ["stop", stopRow],
  ["stateless /suggest", statelessSuggestRow],
  ["IntelligenceAgent mid-run reconnect", intelligenceReconnectRow],
  ["suggestions from a cloned HttpAgent", clonedHttpAgentSuggestRow],
  ["trajectory connect", trajectoryConnectRow],
];

describe("core-owned requests carry the current token at send time (#1937)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof fetch }).fetch;
    }
  });

  it.each(rows)("%s carries the current (fresh) token", async (_name, run) => {
    await expect(run()).resolves.toBe("fresh");
  });

  it("memory store: a removed key is not sent from a stale context copy", () =>
    withBrowserWindow(async () => {
      let signedIn = true;
      const calls: Call[] = [];
      global.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          calls.push({ url, auth: authOf(init) });
          if (url.endsWith("/info")) {
            return jsonResponse({
              version: "1.0.0",
              agents: {},
              mode: "intelligence",
              intelligence: { wsUrl: "wss://gw.example.com/client" },
            });
          }
          if (url.includes("/memories") && !url.includes("subscribe")) {
            return jsonResponse({ memories: [] });
          }
          return jsonResponse({});
        },
      ) as unknown as typeof fetch;

      const core = new CopilotKitCore({
        runtimeUrl: "https://rt.test/api",
        runtimeTransport: "rest",
        headers: () => (signedIn ? { Authorization: "Bearer x" } : {}),
      });
      await vi.waitFor(() =>
        expect(core.runtimeConnectionStatus).toBe(
          CopilotKitCoreRuntimeConnectionStatus.Connected,
        ),
      );
      const store = core.getMemoryStore();
      await vi.waitFor(() =>
        expect(
          calls.some(
            (c) => c.url.includes("/memories") && !c.url.includes("subscribe"),
          ),
        ).toBe(true),
      );
      expect(
        calls.find(
          (c) => c.url.includes("/memories") && !c.url.includes("subscribe"),
        )?.auth,
      ).toBe("Bearer x");

      calls.length = 0;
      signedIn = false;
      await store.refresh();
      const call = calls.find(
        (c) => c.url.includes("/memories") && !c.url.includes("subscribe"),
      );
      expect(call).toBeDefined();
      expect(call!.auth).toBeNull();
    }));
});

describe("token churn vs. setHeaders", () => {
  const originalFetch = global.fetch;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as { fetch?: typeof fetch }).fetch;
    }
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("a new token causes no /info refetch and no onHeadersChanged; setHeaders fires onHeadersChanged and refreshes inspector metadata, not /info", async () => {
    const calls: Call[] = [];
    let token = "t1";
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        calls.push({ url, auth: authOf(init) });
        if (url.endsWith("/info")) {
          return jsonResponse({
            version: "1.0.0",
            agents: {},
            inspectorMetadata: true,
          });
        }
        // /inspector-metadata
        return jsonResponse({
          schemaVersion: 1,
          plan: { code: "free", label: "Free" },
          usage: { used: 0, limit: { kind: "finite", value: 1 } },
        });
      },
    ) as unknown as typeof fetch;

    const onHeadersChanged = vi.fn();
    const core = new CopilotKitCore({
      runtimeUrl: "https://rt.test/api",
      headers: () => ({ Authorization: token }),
    });
    core.subscribe({ onHeadersChanged });

    await vi.waitFor(() =>
      expect(core.runtimeConnectionStatus).toBe(
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      ),
    );
    await vi.waitFor(() =>
      expect(calls.some((c) => c.url.endsWith("/inspector-metadata"))).toBe(
        true,
      ),
    );
    const infoCallsAfterConnect = calls.filter((c) =>
      c.url.endsWith("/info"),
    ).length;

    // A new token from the builder alone must not retrigger anything. Send a
    // real request AFTER the token change — otherwise nothing ever calls the
    // builder, and a resolver that wrongly refetched /info or fired
    // onHeadersChanged on a new (but not explicitly re-set) token would pass
    // vacuously.
    token = "t2";
    await core.ɵruntimeFetch("https://rt.test/api/threads");
    const threadsCall = calls.find((c) => c.url.endsWith("/threads"));
    expect(threadsCall?.auth).toBe("t2"); // the builder really was called
    expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(
      infoCallsAfterConnect,
    );
    expect(onHeadersChanged).not.toHaveBeenCalled();

    const metadataCallsBeforeSetHeaders = calls.filter((c) =>
      c.url.endsWith("/inspector-metadata"),
    ).length;

    // An explicit setHeaders call must notify subscribers and refresh
    // inspector metadata (the endpoint this task also resolves headers for) —
    // not /info, which is only ever fetched on (re)connect.
    core.setHeaders(() => ({ Authorization: "t3" }));
    await vi.waitFor(() =>
      expect(
        calls.filter((c) => c.url.endsWith("/inspector-metadata")).length,
      ).toBeGreaterThan(metadataCallsBeforeSetHeaders),
    );
    expect(onHeadersChanged).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.url.endsWith("/info")).length).toBe(
      infoCallsAfterConnect,
    );
  });

  it("an /info header failure warns about headers, not about the runtime being unreachable", async () => {
    let resolveCount = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: { default: { name: "default", description: "" } },
        });
      }
      // The triggering run fails for a plain network reason, not headers.
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://rt.test/api",
      headers: () => {
        resolveCount += 1;
        // Calls 1 (initial /info) and 2 (the failing run's own header
        // resolution) succeed; call 3 (the reachability probe's /info
        // re-fetch, triggered by the run's network failure) fails.
        if (resolveCount > 2) {
          throw new Error("boom");
        }
        return { Authorization: "tok" };
      },
    });
    await waitForCondition(() => core.getAgent("default") !== undefined);
    warnSpy.mockClear();

    await core.runAgent({ agent: core.getAgent("default")! }).catch(() => {});

    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    const messages = warnSpy.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.toLowerCase().includes("header"))).toBe(true);
    expect(messages.some((m) => m.toLowerCase().includes("unreachable"))).toBe(
      false,
    );
  });
});
