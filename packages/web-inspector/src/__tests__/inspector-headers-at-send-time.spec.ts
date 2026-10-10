import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
} from "@copilotkit/core";
import type { CopilotKitHeadersSource } from "@copilotkit/core";
import { expect, test, vi } from "vitest";

import { CpkThreadInspector, WebInspectorElement } from "../index.js";

// #1937: headers must be resolved AT SEND TIME everywhere the inspector talks
// to the runtime, never snapshotted once and reused. These tests cover the
// two direct CpkThreadInspector fetches and the inspector-owned thread
// store, and prove that a header VALUE change (a token rotation through the
// same builder) never reloads thread inspection -- only a real header
// SOURCE change (core.setHeaders) does, exactly once.

const RUNTIME_URL = "http://localhost:4000/api/copilotkit";
const AGENT_ID = "alpha";

type RequestRecord = {
  route: string;
  headers: Record<string, string>;
};

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function classifyRoute(url: URL): string | null {
  if (url.pathname.endsWith("/threads/subscribe")) return "subscribe";
  if (/\/threads\/[^/]+\/messages$/.test(url.pathname)) return "messages";
  if (/\/threads\/[^/]+\/events$/.test(url.pathname)) return "events";
  if (/\/threads\/[^/]+\/state$/.test(url.pathname)) return "state";
  if (/\/threads\/[^/]+$/.test(url.pathname)) return "inspect";
  if (url.pathname.endsWith("/threads")) return "list";
  return null;
}

function headersOfInit(init: RequestInit | undefined): Record<string, string> {
  const headers = init?.headers;
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return { ...(headers as Record<string, string>) };
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
    const detail =
      inspector.shadowRoot?.querySelector<CpkThreadInspector>(
        "cpk-thread-details",
      );
    if (detail) await detail.updateComplete;
  }
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

type Harness = {
  core: CopilotKitCore;
  inspector: WebInspectorElement;
  requests: () => RequestRecord[];
  requestsOf: (route: string) => RequestRecord[];
  flush: () => Promise<void>;
  open: () => Promise<void>;
  selectThread: () => Promise<void>;
  teardown: () => void;
};

async function setup(
  headers: CopilotKitHeadersSource,
  options: { externalStore?: boolean } = {},
): Promise<Harness> {
  document.body.replaceChildren();
  window.localStorage.clear();

  const requests: RequestRecord[] = [];

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = input instanceof Request ? input.url : String(input);
      if (rawUrl === "https://cdn.copilotkit.ai/announcements.json") {
        return new Response(null, { status: 404 });
      }
      const url = new URL(rawUrl, window.location.href);
      if (url.pathname.endsWith("/info")) {
        return jsonResponse({
          version: "1.0.0",
          agents: { [AGENT_ID]: {} },
          audioFileTranscriptionEnabled: false,
          mode: "sse",
          intelligence: { wsUrl: "" },
          threadEndpoints: {
            list: true,
            inspect: true,
            mutations: false,
            realtimeMetadata: false,
          },
          telemetryDisabled: true,
        });
      }
      const route = classifyRoute(url);
      if (route) {
        requests.push({ route, headers: headersOfInit(init) });
      }
      if (route === "list") {
        return jsonResponse({
          threads: [
            {
              id: "real-thread-1",
              organizationId: "org-1",
              agentId: AGENT_ID,
              createdById: "user-1",
              name: "Real thread",
              archived: false,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          joinCode: null,
        });
      }
      if (route === "inspect") return jsonResponse({ thread: null });
      if (route === "messages") return jsonResponse({ messages: [] });
      if (route === "events") return jsonResponse({ events: [] });
      if (route === "state") return jsonResponse({ state: {} });
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CopilotKitCore({
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: "rest",
    deferInitialConnection: true,
    headers,
  });

  // Register the store BEFORE the inspector ever attaches, so
  // `ensureOwnedThreadStore`'s `core.getThreadStore(agentId)` guard sees it
  // already registered and never calls `setContext` on it itself. This is
  // the same pattern `thread-capability.spec.ts` uses for a caller-owned
  // store, and it isolates a test from the owned store's own
  // `onHeadersChanged` -> `setContext` reload side effect.
  if (options.externalStore) {
    const externalStore = ɵcreateThreadStore({ fetch: core.ɵruntimeFetch });
    externalStore.start();
    externalStore.setContext({ runtimeUrl: RUNTIME_URL, agentId: AGENT_ID });
    core.registerThreadStore(AGENT_ID, externalStore);
  }

  const inspector = new WebInspectorElement();
  Reflect.set(inspector, "autoAttachCore", false);
  document.body.appendChild(inspector);
  inspector.core = core;
  core.connect();

  await waitFor(
    () =>
      core.runtimeConnectionStatus ===
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    "the Core handshake",
  );
  await flushInspector(inspector);

  return {
    core,
    inspector,
    requests: () => requests.slice(),
    requestsOf: (route) => requests.filter((r) => r.route === route),
    flush: () => flushInspector(inspector),
    open: async () => {
      const openButton = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      );
      if (!openButton) throw new Error("Web Inspector open button not found");
      openButton.click();
      await flushInspector(inspector);
      const threadsButton = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === "Rich Threads");
      if (!threadsButton) throw new Error("Threads menu button not found");
      threadsButton.click();
      await flushInspector(inspector);
    },
    selectThread: async () => {
      const list = inspector.shadowRoot?.querySelector("cpk-thread-list");
      await waitFor(
        () => !!list?.shadowRoot?.querySelector(".cpk-tl__item"),
        "the real thread row",
      );
      const row = list?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
      row?.click();
      await flushInspector(inspector);
    },
    teardown: () => {
      inspector.remove();
      core.setRuntimeUrl(undefined);
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      document.body.replaceChildren();
      window.localStorage.clear();
    },
  };
}

test("sends the freshly resolved token on a token rotation, both for the owned store's list refetch and the selected thread's runtime fetch", async () => {
  let token = "first";
  const context = await setup(() => ({ Authorization: `Bearer ${token}` }));
  try {
    await waitFor(
      () => context.requestsOf("list").length > 0,
      "the owned store's initial list request",
    );
    expect(context.requestsOf("list")[0]?.headers.Authorization).toBe(
      "Bearer first",
    );

    // Rotate the token through the SAME builder identity -- no setHeaders
    // call, so `ɵheadersGeneration` does not change.
    token = "second";
    const store = context.core.getThreadStore(AGENT_ID);
    if (!store) throw new Error("Owned thread store was not registered");
    store.refresh();
    await context.flush();

    await waitFor(
      () => context.requestsOf("list").length >= 2,
      "the owned store's refreshed list request",
    );
    expect(context.requestsOf("list").at(-1)?.headers.Authorization).toBe(
      "Bearer second",
    );

    await context.open();
    await context.selectThread();

    await waitFor(
      () => context.requestsOf("messages").length > 0,
      "the selected thread's messages request",
    );
    expect(context.requestsOf("messages")[0]?.headers.Authorization).toBe(
      "Bearer second",
    );
    expect(context.requestsOf("events")[0]?.headers.Authorization).toBe(
      "Bearer second",
    );
  } finally {
    context.teardown();
  }
});

test("drops a header key the builder stopped returning instead of keeping it from a stale snapshot", async () => {
  const state = { includeStaleKey: true };
  const context = await setup(() => ({
    Authorization: "Bearer constant",
    ...(state.includeStaleKey ? { "X-Old-Key": "should-not-persist" } : {}),
  }));
  try {
    await waitFor(
      () => context.requestsOf("list").length > 0,
      "the owned store's initial list request",
    );
    // Seed: the key really was sent while the builder still returned it.
    expect(context.requestsOf("list")[0]?.headers["X-Old-Key"]).toBe(
      "should-not-persist",
    );

    state.includeStaleKey = false;
    const store = context.core.getThreadStore(AGENT_ID);
    if (!store) throw new Error("Owned thread store was not registered");
    store.refresh();
    await context.flush();

    await waitFor(
      () => context.requestsOf("list").length >= 2,
      "the owned store's refreshed list request",
    );
    const refreshedList = context.requestsOf("list").at(-1);
    expect(refreshedList?.headers["X-Old-Key"]).toBeUndefined();
    expect(refreshedList?.headers.Authorization).toBe("Bearer constant");

    await context.open();
    await context.selectThread();

    await waitFor(
      () => context.requestsOf("messages").length > 0,
      "the selected thread's messages request",
    );
    expect(
      context.requestsOf("messages")[0]?.headers["X-Old-Key"],
    ).toBeUndefined();
    expect(
      context.requestsOf("events")[0]?.headers["X-Old-Key"],
    ).toBeUndefined();
  } finally {
    context.teardown();
  }
});

// Exercises the REAL `<cpk-thread-details>` template binding
// (`.resolveHeaders=`/`.headersGeneration=` at index.ts) through a real
// selected thread, rather than hand-simulating it. A token rotation alone
// (no `setHeaders`) must not reload thread inspection, even though a real
// request goes out elsewhere (the owned store's list refresh) and even
// though the host itself re-renders.
test("a token rotation through the real template binding does not reload the selected thread, but a real owned-store request carries the fresh token", async () => {
  let token = "first";
  const context = await setup(() => ({ Authorization: `Bearer ${token}` }));
  try {
    await context.open();
    await context.selectThread();
    await waitFor(
      () => context.requestsOf("events").length > 0,
      "the initial thread load",
    );
    await context.flush();
    const baseline = context.requestsOf("events").length;
    expect(baseline).toBe(1);

    // Rotate the token through the SAME builder identity, then do a real
    // request (the owned store's list refresh) AND force the host to
    // re-render, so the real `.resolveHeaders=`/`.headersGeneration=`
    // bindings on `<cpk-thread-details>` get recomputed from `core`.
    token = "second";
    const store = context.core.getThreadStore(AGENT_ID);
    if (!store) throw new Error("Owned thread store was not registered");
    store.refresh();
    context.inspector.requestUpdate();
    await context.flush();

    // Discriminating assertion first: no reload of the selected thread.
    expect(context.requestsOf("events").length).toBe(baseline);

    // The real request that DID go out (the owned store's refresh) still
    // carries the fresh token, proving rotation isn't silently ignored --
    // it's just correctly not treated as a reason to reload.
    await waitFor(
      () => context.requestsOf("list").length >= 2,
      "the owned store's refreshed list request",
    );
    expect(context.requestsOf("list").at(-1)?.headers.Authorization).toBe(
      "Bearer second",
    );
  } finally {
    context.teardown();
  }
});

// Isolates the `setHeaders` half of the reload contract at the integration
// level: the thread store for AGENT_ID is registered externally (mirroring
// `thread-capability.spec.ts`'s caller-owned-store pattern), so
// `ensureOwnedThreadStore` never adopts it and `updateOwnedThreadStoreHeaders`
// never calls `setContext` on it. Any reload observed here can only come
// from `<cpk-thread-details>`'s own load-key/`headersGeneration` gate, not
// from the owned store's unconditional `contextChanged` -> refetch (which
// can independently deselect/reselect the thread and remount the element).
test("a real setHeaders change reloads the selected thread exactly once, against a store the inspector does not own", async () => {
  const context = await setup({}, { externalStore: true });
  try {
    await context.open();
    await context.selectThread();
    await waitFor(
      () => context.requestsOf("events").length > 0,
      "the initial thread load",
    );
    await context.flush();
    const baseline = context.requestsOf("events").length;
    expect(baseline).toBe(1);

    context.core.setHeaders({ Authorization: "Bearer new-value" });
    await context.flush();

    await waitFor(
      () => context.requestsOf("events").length === baseline + 1,
      "the single reload after setHeaders",
    );
    expect(context.requestsOf("events").length).toBe(baseline + 1);
    expect(context.requestsOf("events").at(-1)?.headers.Authorization).toBe(
      "Bearer new-value",
    );

    // Settle further: no additional reload trails behind.
    await context.flush();
    expect(context.requestsOf("events").length).toBe(baseline + 1);
  } finally {
    context.teardown();
  }
});

// An inspector can be attached to a core released before `resolveHeaders()`
// existed. Thread inspection must fall back to that core's static `headers`
// instead of throwing on the missing method.
test("falls back to the static headers of an attached core that has no resolveHeaders", async () => {
  const context = await setup({ Authorization: "Bearer static" });
  try {
    // Shadow the public method only. Core's own requests resolve through its
    // internal accessors, so the owned store keeps working.
    Reflect.set(context.core, "resolveHeaders", undefined);

    await context.open();
    await context.selectThread();

    await waitFor(
      () => context.requestsOf("messages").length > 0,
      "the selected thread's messages request",
    );
    expect(context.requestsOf("messages")[0]?.headers.Authorization).toBe(
      "Bearer static",
    );
    expect(context.requestsOf("events")[0]?.headers.Authorization).toBe(
      "Bearer static",
    );
  } finally {
    context.teardown();
  }
});

// This test isolates CpkThreadInspector's OWN load-key gate (currentLoadKey /
// headersGeneration) from the inspector-owned thread store: dispatching a new
// list-store context (via `core.setHeaders` -> onHeadersChanged) always
// clears that store's threads and refetches, which would otherwise mask a
// broken load-key gate behind an unrelated, legitimate reload. A standalone
// element driven directly by a real core's resolveHeaders/ɵheadersGeneration
// isn't exposed to that confound.
test("does not reload thread inspection on a token rotation, but reloads exactly once on a real setHeaders change", async () => {
  let token = "first";
  const core = new CopilotKitCore({
    runtimeUrl: RUNTIME_URL,
    runtimeTransport: "rest",
    deferInitialConnection: true,
    headers: () => ({ Authorization: `Bearer ${token}` }),
  });

  const requests: RequestRecord[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const route = classifyRoute(url);
      if (route) requests.push({ route, headers: headersOfInit(init) });
      if (route === "events") return jsonResponse({ events: [] });
      if (route === "messages") return jsonResponse({ messages: [] });
      if (route === "state") return jsonResponse({ state: {} });
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  document.body.replaceChildren();

  const detail = new CpkThreadInspector();
  // Mirrors the real template binding in index.ts (`.resolveHeaders=`,
  // `.headersGeneration=`): both are re-derived from `core` on every host
  // render. Standing in for that render pass here, since this element isn't
  // hosted inside a WebInspectorElement.
  const syncFromCore = () => {
    detail.resolveHeaders = () => core.resolveHeaders();
    detail.headersGeneration = core.ɵheadersGeneration;
  };
  syncFromCore();
  detail.runtimeUrl = RUNTIME_URL;
  detail.threadInspectionAvailable = true;
  detail.threadId = "thread-standalone";
  document.body.append(detail);

  const eventFetches = () => requests.filter((r) => r.route === "events");
  const settle = async () => {
    for (let turn = 0; turn < 6; turn += 1) {
      await Promise.resolve();
      await detail.updateComplete;
    }
  };

  try {
    await waitFor(() => eventFetches().length > 0, "the initial thread load");
    await settle();
    const baseline = eventFetches().length;
    expect(baseline).toBe(1);
    expect(eventFetches()[0]?.headers.Authorization).toBe("Bearer first");

    // Discriminating assertion first: a token rotation through the SAME
    // builder identity does not bump `ɵheadersGeneration`, so re-syncing
    // `resolveHeaders`/`headersGeneration` (as a host re-render would) must
    // not reload the already-loaded thread.
    token = "second";
    syncFromCore();
    await settle();
    expect(eventFetches().length).toBe(baseline);

    // A real header-SOURCE change bumps the generation, and must reload
    // exactly once, using the fresh (rotated) token.
    core.setHeaders({ Authorization: `Bearer ${token}` });
    syncFromCore();
    await settle();
    await waitFor(
      () => eventFetches().length === baseline + 1,
      "the single reload after setHeaders",
    );
    expect(eventFetches().at(-1)?.headers.Authorization).toBe("Bearer second");

    // Settle further: no additional reload trails behind.
    await settle();
    expect(eventFetches().length).toBe(baseline + 1);
  } finally {
    detail.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});

// `.headers` was dropped when `resolveHeaders`/`headersGeneration`
// replaced it, silently breaking a host that only ever set `.headers`. It's
// restored as a deprecated fallback, used only when `resolveHeaders` is left
// at its default (unset).
test("a standalone CpkThreadInspector with only .headers set sends them on its fetches", async () => {
  const requests: RequestRecord[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const route = classifyRoute(url);
      if (route) requests.push({ route, headers: headersOfInit(init) });
      if (route === "events") return jsonResponse({ events: [] });
      if (route === "messages") return jsonResponse({ messages: [] });
      if (route === "state") return jsonResponse({ state: {} });
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  document.body.replaceChildren();

  const detail = new CpkThreadInspector();
  // `resolveHeaders` is left at its default (never assigned) — only the
  // deprecated `.headers` fallback is set.
  detail.headers = { Authorization: "Bearer legacy" };
  detail.runtimeUrl = RUNTIME_URL;
  detail.threadInspectionAvailable = true;
  detail.threadId = "thread-legacy-headers";
  document.body.append(detail);

  const eventFetches = () => requests.filter((r) => r.route === "events");
  try {
    await waitFor(() => eventFetches().length > 0, "the initial thread load");
    expect(eventFetches()[0]?.headers.Authorization).toBe("Bearer legacy");
  } finally {
    detail.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});

test("when both .headers and resolveHeaders are set on CpkThreadInspector, resolveHeaders wins", async () => {
  const requests: RequestRecord[] = [];
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.href,
      );
      const route = classifyRoute(url);
      if (route) requests.push({ route, headers: headersOfInit(init) });
      if (route === "events") return jsonResponse({ events: [] });
      if (route === "messages") return jsonResponse({ messages: [] });
      if (route === "state") return jsonResponse({ state: {} });
      return jsonResponse({});
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  document.body.replaceChildren();

  const detail = new CpkThreadInspector();
  detail.headers = { Authorization: "Bearer legacy" };
  detail.resolveHeaders = () => ({ Authorization: "Bearer current" });
  detail.runtimeUrl = RUNTIME_URL;
  detail.threadInspectionAvailable = true;
  detail.threadId = "thread-both-headers";
  document.body.append(detail);

  const eventFetches = () => requests.filter((r) => r.route === "events");
  try {
    await waitFor(() => eventFetches().length > 0, "the initial thread load");
    expect(eventFetches()[0]?.headers.Authorization).toBe("Bearer current");
  } finally {
    detail.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});
