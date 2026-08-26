import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
} from "@copilotkit/core";
import type {
  ProxiedCopilotRuntimeAgent,
  ɵThread,
  ɵThreadStore,
} from "@copilotkit/core";
import type {
  IntelligenceRuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { expect, test, vi } from "vitest";
import { CpkThreadInspector, WebInspectorElement } from "../index.js";
import type { ThreadDebuggerEvent, ThreadDebuggerProvider } from "../index.js";

const RUNTIME_URL = "https://runtime.example.test";
const REGISTERED_AGENT_ID = "alpha";
const OWNED_AGENT_ID = "beta";

const LIST_AND_INSPECT = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

const LIST_ONLY = {
  ...LIST_AND_INSPECT,
  inspect: false,
} satisfies ThreadEndpointRuntimeInfo;

const LIST_DISABLED = {
  ...LIST_AND_INSPECT,
  list: false,
} satisfies ThreadEndpointRuntimeInfo;

type ThreadRequests = Readonly<{
  list: number;
  subscribe: number;
  inspect: number;
  messages: number;
  events: number;
  state: number;
}>;

type ThreadRequestKind = keyof ThreadRequests;

type ThreadSignals = Readonly<{
  list: AbortSignal[];
  subscribe: AbortSignal[];
  inspect: AbortSignal[];
  messages: AbortSignal[];
  events: AbortSignal[];
  state: AbortSignal[];
}>;

const ZERO_REQUESTS: ThreadRequests = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
};

class CapabilityTestCore extends CopilotKitCore {
  private endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly realtimeEnabled: boolean;

  constructor(
    endpoints: ThreadEndpointRuntimeInfo | undefined,
    realtimeEnabled: boolean,
  ) {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    this.endpointsValue = endpoints;
    this.realtimeEnabled = realtimeEnabled;
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return this.realtimeEnabled
      ? { wsUrl: "ws://runtime.example.test/client" }
      : undefined;
  }

  override get telemetryDisabled(): boolean {
    return true;
  }

  async publishEndpoints(
    endpoints: ThreadEndpointRuntimeInfo | undefined,
  ): Promise<void> {
    this.endpointsValue = endpoints;
    await this.emitRuntimeStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    await this.emitAgentsChanged();
  }

  async emitRuntimeStatus(
    status: CopilotKitCoreRuntimeConnectionStatus,
  ): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status,
        }),
      "Capability test runtime-status subscriber failed",
    );
  }

  async emitAgentsChanged(): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: this,
          agents: this.agents,
        }),
      "Capability test agents subscriber failed",
    );
  }

  async emitThreadStoreRegistered(
    agentId: string,
    store: ɵThreadStore,
  ): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onThreadStoreRegistered?.({
          copilotkit: this,
          agentId,
          store,
        }),
      "Capability test thread-store subscriber failed",
    );
  }
}

type RequestLedger = Readonly<{
  increment: (kind: ThreadRequestKind) => void;
  read: () => ThreadRequests;
  reset: () => void;
}>;

function createRequestLedger(): RequestLedger {
  let list = 0;
  let subscribe = 0;
  let inspect = 0;
  let messages = 0;
  let events = 0;
  let state = 0;

  return {
    increment(kind) {
      if (kind === "list") list += 1;
      if (kind === "subscribe") subscribe += 1;
      if (kind === "inspect") inspect += 1;
      if (kind === "messages") messages += 1;
      if (kind === "events") events += 1;
      if (kind === "state") state += 1;
    },
    read: () => ({ list, subscribe, inspect, messages, events, state }),
    reset() {
      list = 0;
      subscribe = 0;
      inspect = 0;
      messages = 0;
      events = 0;
      state = 0;
    },
  };
}

type DeferredResponse = Readonly<{
  promise: Promise<Response>;
  resolve: (response: Response) => void;
}>;

function createDeferredResponse(): DeferredResponse {
  let settled = false;
  let settlePromise: ((response: Response) => void) | null = null;
  const promise = new Promise<Response>((resolve) => {
    settlePromise = resolve;
  });
  return {
    promise,
    resolve(response) {
      if (settled) return;
      if (!settlePromise) {
        throw new Error("Deferred response was not initialized");
      }
      settled = true;
      settlePromise(response);
    },
  };
}

function waitForResponse(
  promise: Promise<Response>,
  signal: AbortSignal | null,
): Promise<Response> {
  if (!signal) return promise;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (response) => {
        signal.removeEventListener("abort", abort);
        resolve(response);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function threadFor(agentId: string): ɵThread {
  return {
    id: `real-thread-${agentId}`,
    organizationId: "organization-1",
    agentId,
    createdById: "user-1",
    name: `Real thread ${agentId}`,
    archived: false,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:01:00.000Z",
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(String(input), window.location.href);
}

function requestSignal(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): AbortSignal | null {
  return init?.signal ?? (input instanceof Request ? input.signal : null);
}

function classifyThreadRequest(url: URL): ThreadRequestKind | null {
  if (url.pathname.endsWith("/threads/subscribe")) return "subscribe";
  if (/\/threads\/[^/]+\/messages$/.test(url.pathname)) return "messages";
  if (/\/threads\/[^/]+\/events$/.test(url.pathname)) return "events";
  if (/\/threads\/[^/]+\/state$/.test(url.pathname)) return "state";
  if (/\/threads\/[^/]+$/.test(url.pathname)) return "inspect";
  if (url.pathname.endsWith("/threads")) return "list";
  return null;
}

function createSseResponse(): Response {
  const encoder = new TextEncoder();
  const events = [
    {
      type: "RUN_STARTED",
      threadId: "real-thread-alpha",
      runId: "run-1",
    },
    {
      type: "RUN_FINISHED",
      threadId: "real-thread-alpha",
      runId: "run-1",
      result: { newMessages: [] },
    },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await inspector.updateComplete;
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  await inspector.updateComplete;
}

type RegisteredStoreHarness = Readonly<{
  store: ɵThreadStore;
  selectCalls: () => number;
  stopCalls: () => number;
}>;

type SetupOptions = Readonly<{
  initialEndpoints: ThreadEndpointRuntimeInfo | undefined;
  agentIds?: readonly string[];
  registeredAgentId?: string;
  listHasRow?: boolean;
  joinData?: boolean;
  deferEvents?: boolean;
}>;

type CapabilityHarness = Readonly<{
  core: CapabilityTestCore;
  inspector: WebInspectorElement;
  primaryAgent: ProxiedCopilotRuntimeAgent;
  registered: RegisteredStoreHarness | null;
  requests: () => ThreadRequests;
  signals: ThreadSignals;
  flush: () => Promise<void>;
  openThreads: () => Promise<void>;
  threadListText: () => string;
  details: () => CpkThreadInspector | null;
  detailsText: () => string;
  selectThread: (name: string) => Promise<void>;
  activateDetailTab: (label: string) => Promise<void>;
  resolveEvents: (events?: ThreadDebuggerEvent[]) => void;
  registerStore: (agentId: string) => Promise<RegisteredStoreHarness>;
  runAgentToFinish: () => Promise<void>;
  teardown: () => Promise<void>;
}>;

function requireRegistered(harness: CapabilityHarness): RegisteredStoreHarness {
  if (!harness.registered) {
    throw new Error("Expected a registered store harness");
  }
  return harness.registered;
}

async function setup(options: SetupOptions): Promise<CapabilityHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();

  const ledger = createRequestLedger();
  const signals: ThreadSignals = {
    list: [],
    subscribe: [],
    inspect: [],
    messages: [],
    events: [],
    state: [],
  };
  const deferredEvents = createDeferredResponse();
  const fetchMock = Object.assign(
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const kind = classifyThreadRequest(url);
      const signal = requestSignal(input, init);
      if (kind) {
        ledger.increment(kind);
        if (signal) signals[kind].push(signal);
      }

      if (kind === "list") {
        const agentId = url.searchParams.get("agentId") ?? REGISTERED_AGENT_ID;
        const threads =
          options.listHasRow === false ? [] : [threadFor(agentId)];
        return new Response(
          JSON.stringify({
            threads,
            joinCode: options.joinData ? "metadata-join-code" : null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (kind === "subscribe") {
        return new Response(
          JSON.stringify({ error: "fixture stops at auth" }),
          {
            status: 503,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (kind === "inspect") {
        return new Response(JSON.stringify({ thread: null }), { status: 200 });
      }
      if (kind === "messages") {
        return new Response(
          JSON.stringify({
            messages: [
              {
                id: "message-1",
                role: "user",
                content: "A real persisted message",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (kind === "events") {
        if (options.deferEvents) {
          return waitForResponse(deferredEvents.promise, signal);
        }
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (kind === "state") {
        return new Response(JSON.stringify({ state: { ready: true } }), {
          status: 200,
        });
      }
      if (/\/agent\/[^/]+\/run$/.test(url.pathname)) {
        return createSseResponse();
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
    globalThis.fetch,
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new CapabilityTestCore(
    options.initialEndpoints,
    options.joinData === true,
  );
  const agentIds = options.agentIds ?? [REGISTERED_AGENT_ID];
  const proxies = agentIds.map((agentId) =>
    core.registerProxiedAgent({
      agentId,
      runtimeAgentId: `runtime-${agentId}`,
    }),
  );
  const primaryAgent = proxies[0]?.agent;
  if (!primaryAgent) throw new Error("Capability setup requires one agent");

  const externalStores = new Set<ɵThreadStore>();
  let registered: RegisteredStoreHarness | null = null;
  if (options.registeredAgentId) {
    const registeredStore = ɵcreateThreadStore({ fetch: fetchMock });
    externalStores.add(registeredStore);
    registeredStore.start();
    registeredStore.setContext({
      runtimeUrl: RUNTIME_URL,
      headers: {},
      agentId: options.registeredAgentId,
    });
    await vi.waitFor(() => {
      expect(ɵselectThreads(registeredStore.getState())).toHaveLength(1);
    });
    ledger.reset();
    for (const routeSignals of Object.values(signals)) {
      routeSignals.splice(0);
    }
    const selectSpy = vi.spyOn(registeredStore, "select");
    const stopSpy = vi.spyOn(registeredStore, "stop");
    registered = {
      store: registeredStore,
      selectCalls: () => selectSpy.mock.calls.length,
      stopCalls: () => stopSpy.mock.calls.length,
    };
    core.registerThreadStore(options.registeredAgentId, registeredStore);
  }

  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await flushInspector(inspector);

  const details = () =>
    inspector.shadowRoot?.querySelector<CpkThreadInspector>(
      "cpk-thread-details",
    ) ?? null;

  return {
    core,
    inspector,
    primaryAgent,
    registered,
    requests: ledger.read,
    signals,
    flush: () => flushInspector(inspector),
    async openThreads() {
      await flushInspector(inspector);
      const openButton = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label^="Web Inspector"]',
      );
      if (!openButton) throw new Error("Web Inspector open button not found");
      openButton.click();
      await flushInspector(inspector);
      const threadsButton = Array.from(
        inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ??
          [],
      ).find((button) => button.textContent?.trim() === "Threads");
      if (!threadsButton) throw new Error("Threads menu button not found");
      threadsButton.click();
      await flushInspector(inspector);
    },
    threadListText: () =>
      inspector.shadowRoot?.querySelector<HTMLElement>("cpk-thread-list")
        ?.shadowRoot?.textContent ?? "",
    details,
    detailsText: () => details()?.shadowRoot?.textContent ?? "",
    async selectThread(name) {
      const threadList =
        inspector.shadowRoot?.querySelector<HTMLElement>("cpk-thread-list");
      const item = Array.from(
        threadList?.shadowRoot?.querySelectorAll<HTMLElement>(
          ".cpk-tl__item",
        ) ?? [],
      ).find((candidate) => candidate.textContent?.includes(name));
      if (!item) throw new Error(`Thread row not found: ${name}`);
      item.click();
      await flushInspector(inspector);
    },
    async activateDetailTab(label) {
      const detail = details();
      if (!detail) throw new Error("Thread details element not found");
      const tab = Array.from(
        detail.shadowRoot?.querySelectorAll<HTMLButtonElement>(
          '[role="tab"]',
        ) ?? [],
      ).find((candidate) => candidate.textContent?.trim() === label);
      if (!tab) throw new Error(`Thread detail tab not found: ${label}`);
      tab.click();
      await flushInspector(inspector);
    },
    resolveEvents(events = []) {
      deferredEvents.resolve(
        new Response(JSON.stringify({ events }), { status: 200 }),
      );
    },
    async registerStore(agentId) {
      const store = ɵcreateThreadStore({ fetch: fetchMock });
      externalStores.add(store);
      const selectSpy = vi.spyOn(store, "select");
      const stopSpy = vi.spyOn(store, "stop");
      core.registerThreadStore(agentId, store);
      await flushInspector(inspector);
      return {
        store,
        selectCalls: () => selectSpy.mock.calls.length,
        stopCalls: () => stopSpy.mock.calls.length,
      };
    },
    async runAgentToFinish() {
      await primaryAgent.runAgent({});
      await flushInspector(inspector);
    },
    async teardown() {
      deferredEvents.resolve(
        new Response(JSON.stringify({ events: [] }), { status: 200 }),
      );
      inspector.remove();
      for (const store of externalStores) store.stop();
      for (const proxy of proxies) proxy.unregister();
      await Promise.resolve();
      document.body.replaceChildren();
      document.getElementById("cpk-inspector-brand-fonts")?.remove();
      window.localStorage.clear();
      window.sessionStorage.clear();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    },
  };
}

test("omitted threadEndpoints on attach makes all real requests zero and ignores a seeded row", async () => {
  const harness = await setup({
    initialEndpoints: undefined,
    agentIds: [REGISTERED_AGENT_ID, OWNED_AGENT_ID],
    registeredAgentId: REGISTERED_AGENT_ID,
  });
  try {
    await harness.openThreads();

    expect(harness.requests()).toEqual(ZERO_REQUESTS);
    expect(requireRegistered(harness).selectCalls()).toBe(0);
    expect(harness.threadListText()).not.toContain("Real thread alpha");
    expect(harness.details()).toBeNull();
  } finally {
    await harness.teardown();
  }
});

test("list false on attach makes all real requests zero and ignores a seeded row", async () => {
  const harness = await setup({
    initialEndpoints: LIST_DISABLED,
    agentIds: [REGISTERED_AGENT_ID, OWNED_AGENT_ID],
    registeredAgentId: REGISTERED_AGENT_ID,
  });
  try {
    await harness.openThreads();

    expect(harness.requests()).toEqual(ZERO_REQUESTS);
    expect(requireRegistered(harness).selectCalls()).toBe(0);
    expect(harness.threadListText()).not.toContain("Real thread alpha");
    expect(harness.details()).toBeNull();
  } finally {
    await harness.teardown();
  }
});

test("list true starts one owned list and one credential attempt without duplicate callbacks", async () => {
  const harness = await setup({
    initialEndpoints: LIST_ONLY,
    joinData: true,
  });
  try {
    await vi.waitFor(() => {
      expect(harness.requests().list).toBe(1);
      expect(harness.requests().subscribe).toBe(1);
    });

    await harness.core.emitRuntimeStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connecting,
    );
    await harness.core.emitAgentsChanged();
    await harness.core.emitAgentsChanged();
    await harness.flush();

    expect(harness.requests()).toEqual({
      ...ZERO_REQUESTS,
      list: 1,
      subscribe: 1,
    });
  } finally {
    await harness.teardown();
  }
});

test("enabled caller-owned store subscribes once and keeps its seeded row without duplicate callbacks", async () => {
  const harness = await setup({
    initialEndpoints: LIST_ONLY,
    registeredAgentId: REGISTERED_AGENT_ID,
  });
  try {
    const registered = requireRegistered(harness);
    await harness.openThreads();
    expect(registered.selectCalls()).toBe(2);
    expect(harness.threadListText()).toContain("Real thread alpha");

    await harness.core.emitRuntimeStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    await harness.core.emitAgentsChanged();
    await harness.core.emitThreadStoreRegistered(
      REGISTERED_AGENT_ID,
      registered.store,
    );
    await harness.core.emitThreadStoreRegistered(
      REGISTERED_AGENT_ID,
      registered.store,
    );
    await harness.flush();

    expect(registered.selectCalls()).toBe(2);
    expect(harness.requests()).toEqual(ZERO_REQUESTS);
  } finally {
    await harness.teardown();
  }
});

test("inspect false may show one real row but makes no real detail requests", async () => {
  const harness = await setup({ initialEndpoints: LIST_ONLY });
  try {
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    await harness.openThreads();

    expect(harness.threadListText()).toContain("Real thread alpha");
    expect(harness.requests()).toEqual({
      ...ZERO_REQUESTS,
      list: 1,
    });
  } finally {
    await harness.teardown();
  }
});

test("inspect true loads events, empty-events messages fallback, and state without inspect", async () => {
  const harness = await setup({ initialEndpoints: LIST_AND_INSPECT });
  try {
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    await harness.openThreads();
    await vi.waitFor(() => {
      expect(harness.requests().events).toBe(1);
      expect(harness.requests().messages).toBe(1);
    });

    await harness.activateDetailTab("State");
    await vi.waitFor(() => expect(harness.requests().state).toBe(1));

    expect(harness.requests()).toEqual({
      list: 1,
      subscribe: 0,
      inspect: 0,
      messages: 1,
      events: 1,
      state: 1,
    });

    const providerSignals: AbortSignal[] = [];
    const provider: ThreadDebuggerProvider = {
      async getEvents(_threadId, { signal }) {
        providerSignals.push(signal);
        return [
          {
            type: providerSignals.length === 1 ? "RUN_STARTED" : "RUN_FINISHED",
            timestamp: "2026-08-03T12:02:00.000Z",
          },
        ];
      },
    };
    const directInspector = new CpkThreadInspector();
    directInspector.threadId = "direct-thread";
    directInspector.provider = provider;
    directInspector.runtimeUrl = RUNTIME_URL;
    directInspector.headers = { Authorization: "Bearer direct-test" };
    directInspector.threadInspectionAvailable = true;
    document.body.append(directInspector);
    await directInspector.updateComplete;
    await vi.waitFor(() => {
      expect(providerSignals.length).toBeGreaterThanOrEqual(1);
      expect(directInspector.shadowRoot?.textContent).toContain(
        "No messages yet",
      );
    });
    const firstSignal = providerSignals.at(-1);
    if (!firstSignal) throw new Error("Expected the first provider signal");
    const initialSignalCount = providerSignals.length;

    directInspector.remove();
    await Promise.resolve();
    await directInspector.updateComplete;

    expect(firstSignal.aborted).toBe(true);

    document.body.append(directInspector);
    await directInspector.updateComplete;
    await vi.waitFor(() => {
      expect(providerSignals.length).toBeGreaterThan(initialSignalCount);
      expect(directInspector.shadowRoot?.textContent).toContain(
        "No messages yet",
      );
    });
    const secondSignal = providerSignals.at(-1);
    if (!secondSignal) throw new Error("Expected the second provider signal");

    expect(secondSignal).not.toBe(firstSignal);
    expect(secondSignal.aborted).toBe(false);
  } finally {
    await harness.teardown();
  }
});

test("absent to enabled starts registered and missing owned work once", async () => {
  const harness = await setup({
    initialEndpoints: undefined,
    agentIds: [REGISTERED_AGENT_ID, OWNED_AGENT_ID],
    registeredAgentId: REGISTERED_AGENT_ID,
  });
  try {
    const registered = requireRegistered(harness);
    expect(harness.requests()).toEqual(ZERO_REQUESTS);
    expect(registered.selectCalls()).toBe(0);

    await harness.core.publishEndpoints(LIST_ONLY);
    await vi.waitFor(() => {
      expect(harness.requests().list).toBe(1);
      expect(registered.selectCalls()).toBe(2);
    });
    await harness.core.emitAgentsChanged();
    await harness.flush();

    expect(harness.requests()).toEqual({ ...ZERO_REQUESTS, list: 1 });
    expect(registered.selectCalls()).toBe(2);
  } finally {
    await harness.teardown();
  }
});

test("false to enabled starts one owned lifecycle", async () => {
  const harness = await setup({ initialEndpoints: LIST_DISABLED });
  try {
    expect(harness.requests()).toEqual(ZERO_REQUESTS);

    await harness.core.publishEndpoints(LIST_ONLY);
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    await harness.core.emitAgentsChanged();
    await harness.flush();

    expect(harness.requests()).toEqual({ ...ZERO_REQUESTS, list: 1 });
  } finally {
    await harness.teardown();
  }
});

test("enabled to absent stops and clears real work while blocking late callbacks", async () => {
  const harness = await setup({
    initialEndpoints: LIST_AND_INSPECT,
    deferEvents: true,
  });
  try {
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    await harness.openThreads();
    await vi.waitFor(() => expect(harness.requests().events).toBe(1));
    const detailSignal = harness.signals.events[0];
    if (!detailSignal) throw new Error("Expected a detail AbortSignal");

    await harness.core.publishEndpoints(undefined);
    await harness.flush();

    expect(detailSignal.aborted).toBe(true);
    expect(harness.core.getThreadStore(REGISTERED_AGENT_ID)).toBeUndefined();
    expect(harness.details()).toBeNull();
    expect(harness.threadListText()).not.toContain("Real thread alpha");

    const requestsAfterLock = harness.requests();
    harness.core.setHeaders({ Authorization: "Bearer later" });
    await harness.core.emitRuntimeStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    await harness.core.emitAgentsChanged();
    await harness.runAgentToFinish();
    const lateStore = await harness.registerStore(REGISTERED_AGENT_ID);
    await harness.flush();

    expect(lateStore.selectCalls()).toBe(0);
    expect(harness.requests()).toEqual(requestsAfterLock);

    harness.resolveEvents([
      {
        type: "RUN_FINISHED",
        timestamp: "2026-08-03T12:02:00.000Z",
        payload: { source: "late" },
      },
    ]);
    await harness.flush();
    expect(harness.details()).toBeNull();
    expect(harness.threadListText()).not.toContain("Real thread alpha");
  } finally {
    await harness.teardown();
  }
});

test("caller replacement survives enabled to false to enabled lifecycle", async () => {
  const harness = await setup({ initialEndpoints: LIST_ONLY });
  try {
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    const ownedStore = harness.core.getThreadStore(REGISTERED_AGENT_ID);
    if (!ownedStore) throw new Error("Expected an Inspector-owned store");
    const ownedStopSpy = vi.spyOn(ownedStore, "stop");
    const ownedSetContextSpy = vi.spyOn(ownedStore, "setContext");
    const ownedRefreshSpy = vi.spyOn(ownedStore, "refresh");

    const replacement = await harness.registerStore(REGISTERED_AGENT_ID);
    await harness.openThreads();

    expect.soft(ownedStopSpy).toHaveBeenCalledTimes(1);
    expect(harness.core.getThreadStore(REGISTERED_AGENT_ID)).toBe(
      replacement.store,
    );
    expect(replacement.selectCalls()).toBe(2);

    harness.core.setHeaders({ Authorization: "Bearer replacement" });
    await harness.core.emitRuntimeStatus(
      CopilotKitCoreRuntimeConnectionStatus.Connected,
    );
    await harness.runAgentToFinish();
    await harness.flush();

    expect.soft(ownedSetContextSpy).not.toHaveBeenCalled();
    expect.soft(ownedRefreshSpy).not.toHaveBeenCalled();

    await harness.core.publishEndpoints(LIST_DISABLED);
    await harness.flush();

    expect(harness.core.getThreadStore(REGISTERED_AGENT_ID)).toBe(
      replacement.store,
    );
    expect(replacement.stopCalls()).toBe(0);
    expect(replacement.selectCalls()).toBe(2);
    expect(harness.details()).toBeNull();
    expect(harness.threadListText()).not.toContain("Real thread alpha");

    await harness.core.publishEndpoints(LIST_ONLY);
    await vi.waitFor(() => expect(replacement.selectCalls()).toBe(4));
    await harness.core.emitAgentsChanged();
    await harness.flush();

    expect(harness.core.getThreadStore(REGISTERED_AGENT_ID)).toBe(
      replacement.store,
    );
    expect(replacement.stopCalls()).toBe(0);
    expect(replacement.selectCalls()).toBe(4);
  } finally {
    await harness.teardown();
  }
});

test("absent to false to absent stays locked without requests or subscriptions", async () => {
  const harness = await setup({
    initialEndpoints: undefined,
    registeredAgentId: REGISTERED_AGENT_ID,
  });
  try {
    const registered = requireRegistered(harness);
    await harness.core.publishEndpoints(LIST_DISABLED);
    await harness.core.publishEndpoints(undefined);
    await harness.flush();

    expect(harness.requests()).toEqual(ZERO_REQUESTS);
    expect(registered.selectCalls()).toBe(0);
    expect(harness.core.getThreadStore(REGISTERED_AGENT_ID)).toBe(
      registered.store,
    );
  } finally {
    await harness.teardown();
  }
});

test("enabled zero keeps all three local examples and their providers off real routes", async () => {
  const harness = await setup({
    initialEndpoints: LIST_AND_INSPECT,
    listHasRow: false,
  });
  try {
    await vi.waitFor(() => expect(harness.requests().list).toBe(1));
    await harness.openThreads();

    expect(harness.threadListText()).toContain("Realtime thread sync");
    expect(harness.threadListText()).toContain("Manage saved conversations");
    expect(harness.threadListText()).toContain("Inspect durable run history");

    await harness.selectThread("Realtime thread sync");
    await vi.waitFor(() =>
      expect(harness.detailsText()).toContain(
        "Resume the checkout support thread from yesterday.",
      ),
    );
    const detail = harness.details();
    if (!detail?.provider?.getMessages) {
      throw new Error("Expected the local example messages provider");
    }
    const messagesSpy = vi.spyOn(detail.provider, "getMessages");
    detail.liveMessageVersion += 1;
    detail.requestUpdate();
    await vi.waitFor(() => expect(messagesSpy).toHaveBeenCalledTimes(1));

    await harness.activateDetailTab("State");
    await vi.waitFor(() =>
      expect(harness.detailsText()).toContain("cart_demo_42"),
    );

    expect(harness.requests()).toEqual({ ...ZERO_REQUESTS, list: 1 });
  } finally {
    await harness.teardown();
  }
});
