import { HttpAgent } from "@ag-ui/client";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  ɵcreateThreadStore,
  ɵselectThreads,
  ɵselectThreadsError,
  ɵselectThreadsIsLoading,
} from "@copilotkit/core";
import type {
  InspectorMetadataV1,
  RuntimeLicenseStatus,
  ɵThread,
  ɵThreadStore,
} from "@copilotkit/core";
import type {
  IntelligenceRuntimeInfo,
  ThreadEndpointRuntimeInfo,
} from "@copilotkit/shared";
import { expect, test, vi } from "vitest";

import { WebInspectorElement } from "../index.js";
import type { CpkThreadInspector } from "../index.js";
import { TELEMETRY_EVENTS, TELEMETRY_INGEST_URL } from "../lib/telemetry.js";

const RUNTIME_URL = "https://runtime.example.test";
const AGENT_ID = "state-agent";

const EMPTY_DEMO_VIEW_EVENTS: ReadonlySet<string> = new Set([
  TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
  TELEMETRY_EVENTS.threadsExampleViewed,
]);

const ENABLED_ENDPOINTS = {
  list: true,
  inspect: true,
  mutations: false,
  realtimeMetadata: false,
} satisfies ThreadEndpointRuntimeInfo;

const DISABLED_ENDPOINTS = {
  ...ENABLED_ENDPOINTS,
  list: false,
} satisfies ThreadEndpointRuntimeInfo;

const THREAD_ROUTES = [
  "list",
  "subscribe",
  "inspect",
  "messages",
  "events",
  "state",
] as const;

type ThreadRoute = (typeof THREAD_ROUTES)[number];
type ThreadRoutes = Readonly<Record<ThreadRoute, number>>;

const ZERO_ROUTES = {
  list: 0,
  subscribe: 0,
  inspect: 0,
  messages: 0,
  events: 0,
  state: 0,
} as const satisfies ThreadRoutes;

type ThreadListElement = HTMLElement & {
  threads: ɵThread[];
  selectedThreadId: string | null;
  errorMessage: string | null;
  suppressEmptyState: boolean;
};

type TelemetryBody = Readonly<{
  event: string;
  properties: Readonly<Record<string, unknown>>;
}>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelemetryBody(raw: string): TelemetryBody {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed) ||
    typeof parsed.event !== "string" ||
    !isRecord(parsed.properties)
  ) {
    throw new Error("Telemetry request body had an unexpected shape");
  }
  return { event: parsed.event, properties: parsed.properties };
}

type ResponseQueue = Readonly<{
  next: (signal: AbortSignal | null) => Promise<Response>;
  resolveNext: (response: Response) => void;
}>;

type StateHarness = Readonly<{
  inspector: WebInspectorElement;
  store: ɵThreadStore;
  telemetryBodies: TelemetryBody[];
  flush: () => Promise<void>;
  openThreads: () => Promise<void>;
  threadList: () => ThreadListElement;
  resolveList: (threads?: readonly ɵThread[]) => void;
  teardown: () => Promise<void>;
}>;

type SettledStateOptions = Readonly<{
  endpoints: ThreadEndpointRuntimeInfo | undefined;
  initialThreads?: readonly ɵThread[];
  deferNextList?: boolean;
  listErrorAfterRows?: string;
  metadata?: InspectorMetadataV1;
  runtimeLicense?: RuntimeLicenseStatus;
  telemetryDisabled?: boolean;
}>;

type SettledStateHarness = Readonly<{
  core: StateTestCore;
  inspector: WebInspectorElement;
  store: ɵThreadStore;
  telemetryBodies: TelemetryBody[];
  routes: () => ThreadRoutes;
  flush: () => Promise<void>;
  threadList: () => ThreadListElement;
  rows: () => HTMLButtonElement[];
  details: () => CpkThreadInspector | null;
  selectRow: (name: string) => Promise<void>;
  selectDetailTab: (label: string) => Promise<void>;
  resolveDeferredList: (threads?: readonly ɵThread[]) => void;
  teardown: () => Promise<void>;
}>;

class StateTestCore extends CopilotKitCore {
  private readonly endpointsValue: ThreadEndpointRuntimeInfo | undefined;
  private readonly metadataValue: InspectorMetadataV1 | undefined;
  private readonly runtimeLicenseValue: RuntimeLicenseStatus | undefined;
  private readonly telemetryDisabledValue: boolean;

  constructor(options: Partial<SettledStateOptions> = {}) {
    super({
      runtimeUrl: RUNTIME_URL,
      runtimeTransport: "rest",
      deferInitialConnection: true,
    });
    this.endpointsValue = Object.prototype.hasOwnProperty.call(
      options,
      "endpoints",
    )
      ? options.endpoints
      : ENABLED_ENDPOINTS;
    this.metadataValue = options.metadata;
    this.runtimeLicenseValue = options.runtimeLicense;
    this.telemetryDisabledValue = options.telemetryDisabled ?? false;
  }

  override get threadEndpoints(): ThreadEndpointRuntimeInfo | undefined {
    return this.endpointsValue;
  }

  override get intelligence(): IntelligenceRuntimeInfo | undefined {
    return undefined;
  }

  override get inspectorMetadata(): InspectorMetadataV1 | undefined {
    return this.metadataValue;
  }

  override get licenseStatus(): RuntimeLicenseStatus | undefined {
    return this.runtimeLicenseValue;
  }

  override get telemetryDisabled(): boolean {
    return this.telemetryDisabledValue;
  }

  async emitConnected(): Promise<void> {
    await this.notifySubscribers(
      (subscriber) =>
        subscriber.onRuntimeConnectionStatusChanged?.({
          copilotkit: this,
          status: CopilotKitCoreRuntimeConnectionStatus.Connected,
        }),
      "State test runtime subscriber failed",
    );
  }
}

function createResponseQueue(): ResponseQueue {
  const queued: Response[] = [];
  const waiting: Array<(response: Response) => void> = [];
  return {
    next(signal) {
      const response = queued.shift();
      const pending = response
        ? Promise.resolve(response)
        : new Promise<Response>((resolve) => waiting.push(resolve));
      return waitForResponse(pending, signal);
    },
    resolveNext(response) {
      const resolve = waiting.shift();
      if (resolve) {
        resolve(response);
      } else {
        queued.push(response);
      }
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof Request ? input.url : String(input),
    window.location.href,
  );
}

function classifyThreadRoute(url: URL): ThreadRoute | null {
  if (url.pathname.endsWith("/threads/subscribe")) return "subscribe";
  if (/\/threads\/[^/]+\/messages$/.test(url.pathname)) return "messages";
  if (/\/threads\/[^/]+\/events$/.test(url.pathname)) return "events";
  if (/\/threads\/[^/]+\/state$/.test(url.pathname)) return "state";
  if (/\/threads\/[^/]+$/.test(url.pathname)) return "inspect";
  if (url.pathname.endsWith("/threads")) return "list";
  return null;
}

function realThread(id = "real-thread"): ɵThread {
  return {
    id,
    organizationId: "organization-1",
    agentId: AGENT_ID,
    createdById: "user-1",
    name: "Persisted support thread",
    archived: false,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:01:00.000Z",
  };
}

function inspectorMetadata(
  licenseState: "valid" | "none" | "expired" | "unknown",
  actionKind?: "manage_plan" | "renew" | "enable_intelligence",
  actionUrl = "https://cloud.copilotkit.ai/actions/manage",
  usage?: NonNullable<InspectorMetadataV1["usage"]>,
): InspectorMetadataV1 {
  return {
    schemaVersion: 1,
    license: { state: licenseState },
    ...(actionKind ? { action: { kind: actionKind, url: actionUrl } } : {}),
    ...(usage ? { usage } : {}),
  };
}

function telemetryFor(
  bodies: readonly TelemetryBody[],
  event: string,
): TelemetryBody[] {
  return bodies.filter((body) => body.event === event);
}

function requireControl(root: ShadowRoot, label: string): HTMLElement {
  const control = Array.from(
    root.querySelectorAll<HTMLElement>("button, a"),
  ).find((candidate) => candidate.textContent?.trim() === label);
  if (!control) throw new Error(`Control was not rendered: ${label}`);
  return control;
}

/**
 * Exercises every local example and both tour exits without adding thread work.
 */
async function exerciseLocalExamples(
  harness: SettledStateHarness,
  expectedRoutes: ThreadRoutes,
  errorPrefix: string,
): Promise<void> {
  const root = harness.inspector.shadowRoot!;
  const examples = [
    "Realtime thread sync",
    "Manage saved conversations",
    "Inspect durable run history",
  ] as const;

  for (const name of examples) {
    await harness.selectRow(name);
    const detail = harness.details();
    if (!detail?.provider || !detail.threadId) {
      throw new Error(
        `${errorPrefix} local detail was not rendered for ${name}`,
      );
    }
    const assertDetailStaysLocal = (): void => {
      expect(harness.details()).not.toBeNull();
      expect(harness.details()?.provider).toBe(detail.provider);
      expect(harness.details()?.threadId).toBe(detail.threadId);
      expect(harness.details()?.runtimeUrl).toBe("");
      expect(harness.routes()).toEqual(expectedRoutes);
    };
    const clickTourControl = async (label: string): Promise<void> => {
      requireControl(root, label).click();
      await harness.flush();
      assertDetailStaysLocal();
    };
    const loadOptions = { signal: new AbortController().signal };

    expect(detail.runtimeUrl).toBe("");
    expect(
      await detail.provider.getMessages?.(detail.threadId, loadOptions),
    ).not.toEqual([]);
    expect(
      await detail.provider.getEvents?.(detail.threadId, loadOptions),
    ).not.toEqual([]);
    expect(
      await detail.provider.getState?.(detail.threadId, loadOptions),
    ).not.toEqual({});
    await harness.selectDetailTab("AG-UI Events");
    await harness.selectDetailTab("State");
    await harness.selectDetailTab("Messages");
    assertDetailStaysLocal();

    if (name === "Realtime thread sync") {
      await clickTourControl("Skip");
    }
    if (name === "Manage saved conversations") {
      await clickTourControl("Show tour");
      await clickTourControl("Next");
      await clickTourControl("Back");
      await clickTourControl("Next");
      await clickTourControl("Next");
      await clickTourControl("Done");
      expect(root.querySelector('[role="dialog"]')).toBeNull();
    }
  }
}

function stubReducedMotion(): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      return {
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      } satisfies MediaQueryList;
    }),
  );
}

function waitForResponse(
  response: Promise<Response>,
  signal: AbortSignal | null,
): Promise<Response> {
  if (!signal) return response;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    response.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

async function flushInspector(inspector: WebInspectorElement): Promise<void> {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
    await inspector.updateComplete;
  }
}

async function setupSettledState(
  options: SettledStateOptions,
): Promise<SettledStateHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubReducedMotion();

  const routeCounts: Record<ThreadRoute, number> = { ...ZERO_ROUTES };
  const telemetryBodies: TelemetryBody[] = [];
  const deferredListResponses = createResponseQueue();
  let listRequestIndex = 0;
  const fetchMock = Object.assign(
    vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = requestUrl(input);
        if (url.href === TELEMETRY_INGEST_URL) {
          if (typeof init?.body === "string") {
            telemetryBodies.push(parseTelemetryBody(init.body));
          }
          return new Response(null, { status: 204 });
        }
        if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
          return new Response(null, { status: 404 });
        }

        const route = classifyThreadRoute(url);
        if (!route) {
          throw new Error(`Unexpected settled-state request: ${url.href}`);
        }
        routeCounts[route] += 1;
        if (route === "list") {
          listRequestIndex += 1;
          if (listRequestIndex > 1 && options.listErrorAfterRows) {
            throw new Error(options.listErrorAfterRows);
          }
          if (listRequestIndex > 1 && options.deferNextList) {
            return deferredListResponses.next(
              init?.signal ?? (input instanceof Request ? input.signal : null),
            );
          }
          return jsonResponse({
            threads: options.initialThreads ?? [],
            joinCode: null,
          });
        }
        if (route === "messages") {
          return jsonResponse({ messages: [] });
        }
        if (route === "events") {
          return jsonResponse({ events: [] });
        }
        if (route === "state") {
          return jsonResponse({ state: {} });
        }
        if (route === "inspect") {
          return jsonResponse({ thread: null });
        }
        return new Response(null, { status: 503 });
      },
    ),
    { preconnect: fetch.preconnect },
  );
  vi.stubGlobal("fetch", fetchMock);

  const store = ɵcreateThreadStore({ fetch: fetchMock });
  store.start();
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: AGENT_ID,
  });
  await vi.waitFor(() => {
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(false);
    expect(
      ɵselectThreads(store.getState())
        .map((thread) => thread.id)
        .sort(),
    ).toEqual((options.initialThreads ?? []).map((thread) => thread.id).sort());
  });

  if (options.listErrorAfterRows) {
    store.refresh();
    await vi.waitFor(() => {
      expect(ɵselectThreadsError(store.getState())).not.toBeNull();
    });
  }

  if (!options.endpoints || options.endpoints.list === false) {
    for (const route of THREAD_ROUTES) {
      routeCounts[route] = 0;
    }
  }

  const core = new StateTestCore(options);
  core.registerThreadStore(AGENT_ID, store);
  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitConnected();
  await flushInspector(inspector);

  const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[aria-label="Web Inspector"]',
  );
  if (!opener) throw new Error("Web Inspector opener was not rendered");
  opener.click();
  await flushInspector(inspector);
  const threadsButton = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
    'button[data-inspector-group="threads"]',
  );
  if (!threadsButton) throw new Error("Threads group was not rendered");
  threadsButton.click();
  await flushInspector(inspector);

  const threadList = (): ThreadListElement => {
    const list =
      inspector.shadowRoot?.querySelector<ThreadListElement>("cpk-thread-list");
    if (!list) throw new Error("Thread list was not rendered");
    return list;
  };
  const rows = (): HTMLButtonElement[] =>
    Array.from(
      threadList().shadowRoot?.querySelectorAll<HTMLButtonElement>(
        ".cpk-tl__item",
      ) ?? [],
    );
  const details = (): CpkThreadInspector | null =>
    inspector.shadowRoot?.querySelector<CpkThreadInspector>(
      "cpk-thread-details",
    ) ?? null;

  return {
    core,
    inspector,
    store,
    telemetryBodies,
    routes: () => ({ ...routeCounts }),
    flush: () => flushInspector(inspector),
    threadList,
    rows,
    details,
    async selectRow(name) {
      const row = rows().find((candidate) =>
        candidate.textContent?.includes(name),
      );
      if (!row) throw new Error(`Thread row was not rendered: ${name}`);
      row.click();
      await flushInspector(inspector);
    },
    async selectDetailTab(label) {
      const detail = details();
      if (!detail) throw new Error("Thread details were not rendered");
      const tab = Array.from(
        detail.shadowRoot?.querySelectorAll<HTMLButtonElement>(
          '[role="tab"]',
        ) ?? [],
      ).find((candidate) => candidate.textContent?.trim() === label);
      if (!tab) throw new Error(`Thread detail tab was not rendered: ${label}`);
      tab.click();
      await flushInspector(inspector);
    },
    resolveDeferredList(resolvedThreads = options.initialThreads ?? []) {
      deferredListResponses.resolveNext(
        jsonResponse({ threads: resolvedThreads, joinCode: null }),
      );
    },
    async teardown() {
      deferredListResponses.resolveNext(
        jsonResponse({ threads: [], joinCode: null }),
      );
      inspector.remove();
      core.unregisterThreadStore(AGENT_ID);
      store.stop();
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

async function setupLoadingState(
  options: Partial<SettledStateOptions> = {},
): Promise<StateHarness> {
  document.body.replaceChildren();
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubReducedMotion();

  const listResponses = createResponseQueue();
  const telemetryBodies: TelemetryBody[] = [];
  const fetchMock = Object.assign(
    vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = requestUrl(input);
        if (url.href === TELEMETRY_INGEST_URL) {
          const body = init?.body;
          if (typeof body === "string") {
            telemetryBodies.push(parseTelemetryBody(body));
          }
          return new Response(null, { status: 204 });
        }
        if (url.href === "https://cdn.copilotkit.ai/announcements.json") {
          return new Response(null, { status: 404 });
        }
        if (url.pathname.endsWith("/threads")) {
          return listResponses.next(
            init?.signal ?? (input instanceof Request ? input.signal : null),
          );
        }
        throw new Error(`Unexpected state-test request: ${url.href}`);
      },
    ),
    { preconnect: fetch.preconnect },
  );
  vi.stubGlobal("fetch", fetchMock);

  const core = new StateTestCore({ ...options, endpoints: ENABLED_ENDPOINTS });
  const store = ɵcreateThreadStore({ fetch: fetchMock });
  store.start();
  store.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: AGENT_ID,
  });
  core.registerThreadStore(AGENT_ID, store);

  await vi.waitFor(() => {
    expect(ɵselectThreadsIsLoading(store.getState())).toBe(true);
  });

  const inspector = new WebInspectorElement();
  document.body.append(inspector);
  inspector.core = core;
  await core.emitConnected();
  await flushInspector(inspector);

  const threadList = (): ThreadListElement => {
    const list =
      inspector.shadowRoot?.querySelector<ThreadListElement>("cpk-thread-list");
    if (!list) throw new Error("Thread list was not rendered");
    return list;
  };

  return {
    inspector,
    store,
    telemetryBodies,
    flush: () => flushInspector(inspector),
    async openThreads() {
      const opener = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[aria-label="Web Inspector"]',
      );
      if (!opener) throw new Error("Web Inspector opener was not rendered");
      opener.click();
      await flushInspector(inspector);

      const threads = inspector.shadowRoot?.querySelector<HTMLButtonElement>(
        'button[data-inspector-group="threads"]',
      );
      if (!threads) throw new Error("Threads group was not rendered");
      threads.click();
      await flushInspector(inspector);
    },
    threadList,
    resolveList(threads = []) {
      listResponses.resolveNext(jsonResponse({ threads, joinCode: null }));
    },
    async teardown() {
      listResponses.resolveNext(jsonResponse({ threads: [], joinCode: null }));
      inspector.remove();
      core.unregisterThreadStore(AGENT_ID);
      store.stop();
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

type FooterBodyState = "locked" | "loading" | "error" | "zero" | "real";

async function setupFooterBody(
  state: FooterBodyState,
  metadata: InspectorMetadataV1,
): Promise<
  Readonly<{
    inspector: WebInspectorElement;
    teardown: () => Promise<void>;
  }>
> {
  if (state === "loading") {
    const harness = await setupLoadingState({
      metadata,
      runtimeLicense: "valid",
    });
    await harness.openThreads();
    return harness;
  }
  return setupSettledState({
    endpoints: state === "locked" ? DISABLED_ENDPOINTS : ENABLED_ENDPOINTS,
    initialThreads:
      state === "zero" ? [] : [realThread(`footer-${state}-thread`)],
    ...(state === "error" ? { listErrorAfterRows: "footer error" } : {}),
    metadata,
    runtimeLicense: "valid",
    telemetryDisabled: true,
  });
}

test("initial Thread loading suppresses empty examples, copy, and telemetry", async () => {
  const harness = await setupLoadingState();
  try {
    await harness.openThreads();

    const root = harness.inspector.shadowRoot!;
    const listText = harness.threadList().shadowRoot?.textContent ?? "";
    const threadEvents = harness.telemetryBodies.filter(({ event }) =>
      EMPTY_DEMO_VIEW_EVENTS.has(event),
    );

    const loadingStatus = root.querySelector('[role="status"]');
    expect(loadingStatus).not.toBeNull();
    expect(loadingStatus?.textContent ?? "").toContain("Loading threads");
    expect(harness.threadList().threads).toEqual([]);
    expect(listText).not.toContain("No threads yet");
    expect(listText).not.toContain("Realtime thread sync");
    expect(root.textContent).not.toContain("See how Threads work");
    expect(threadEvents).toEqual([]);

    harness.resolveList();
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(harness.store.getState())).toBe(false);
    });
    await harness.flush();

    const settledRows = Array.from(
      harness
        .threadList()
        .shadowRoot?.querySelectorAll<HTMLElement>(".cpk-tl__item") ?? [],
    );
    const settledEvents = harness.telemetryBodies.filter(({ event }) =>
      EMPTY_DEMO_VIEW_EVENTS.has(event),
    );
    expect(settledRows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Realtime thread sync"),
      expect.stringContaining("Manage saved conversations"),
      expect.stringContaining("Inspect durable run history"),
    ]);
    expect(harness.threadList().threads.map((thread) => thread.id)).toEqual([
      "example-realtime-sync",
      "example-manage-history",
      "example-inspect-runs",
    ]);
    expect(root.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      settledEvents.filter(
        ({ event }) => event === TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      ),
    ).toHaveLength(1);
    expect(
      settledEvents.filter(
        ({ event }) => event === TELEMETRY_EVENTS.threadsExampleViewed,
      ),
    ).toHaveLength(3);

    harness.store.refresh();
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(harness.store.getState())).toBe(true);
    });
    await harness.flush();

    const refreshingText = harness.threadList().shadowRoot?.textContent ?? "";
    expect(harness.threadList().threads).toEqual([]);
    expect(root.querySelector('[role="status"]')?.textContent ?? "").toContain(
      "Loading threads",
    );
    expect(refreshingText).not.toContain("No threads yet");
    expect(refreshingText).not.toContain("Realtime thread sync");
    expect(root.textContent).not.toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      harness.telemetryBodies.filter(({ event }) =>
        EMPTY_DEMO_VIEW_EVENTS.has(event),
      ),
    ).toHaveLength(settledEvents.length);

    harness.resolveList();
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(harness.store.getState())).toBe(false);
    });
    await harness.flush();
    expect(
      harness.threadList().shadowRoot?.querySelectorAll(".cpk-tl__item").length,
    ).toBe(3);
    expect(root.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      harness.telemetryBodies.filter(({ event }) =>
        EMPTY_DEMO_VIEW_EVENTS.has(event),
      ),
    ).toHaveLength(settledEvents.length);
  } finally {
    await harness.teardown();
  }
});

test("loading projects across all agents and clears when a store unregisters", async () => {
  const harness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [],
    telemetryDisabled: true,
  });
  const betaResponses = createResponseQueue();
  const betaFetch = Object.assign(
    vi.fn(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = requestUrl(input);
        if (!url.pathname.endsWith("/threads")) {
          throw new Error(`Unexpected beta request: ${url.href}`);
        }
        return betaResponses.next(
          init?.signal ?? (input instanceof Request ? input.signal : null),
        );
      },
    ),
    { preconnect: fetch.preconnect },
  );
  const betaStore = ɵcreateThreadStore({ fetch: betaFetch });
  betaStore.start();
  betaStore.setContext({
    runtimeUrl: RUNTIME_URL,
    headers: {},
    agentId: "beta",
  });

  try {
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(betaStore.getState())).toBe(true);
    });
    harness.core.registerThreadStore("beta", betaStore);
    harness.core.setAgents__unsafe_dev_only({
      [AGENT_ID]: new HttpAgent({ url: `${RUNTIME_URL}/agents/${AGENT_ID}` }),
      beta: new HttpAgent({ url: `${RUNTIME_URL}/agents/beta` }),
    });
    await harness.flush();

    const root = harness.inspector.shadowRoot!;
    const selectContext = async (label: string): Promise<void> => {
      const trigger = root.querySelector<HTMLButtonElement>(
        '[data-context-dropdown-root="true"] > button',
      );
      if (!trigger) throw new Error("Context dropdown was not rendered");
      trigger.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      );
      await harness.flush();
      const option = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button"),
      ).find((button) => button.textContent?.trim() === label);
      if (!option) {
        throw new Error(`Context option was not rendered: ${label}`);
      }
      option.click();
      await harness.flush();
    };

    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Loading threads",
    );
    await selectContext(AGENT_ID);
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(harness.rows()).toHaveLength(3);

    await selectContext("beta");
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Loading threads",
    );
    await selectContext("All Agents");
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Loading threads",
    );

    harness.core.unregisterThreadStore("beta");
    await harness.flush();
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(harness.rows()).toHaveLength(3);
  } finally {
    betaResponses.resolveNext(jsonResponse({ threads: [], joinCode: null }));
    harness.core.unregisterThreadStore("beta");
    harness.core.setAgents__unsafe_dev_only({});
    betaStore.stop();
    await harness.teardown();
  }
});

const lockedCapabilityCases = [
  {
    name: "absent capability",
    endpoints: undefined,
    threadServiceStatus: "unknown",
    intelligenceStatus: "unknown",
  },
  {
    name: "list false capability",
    endpoints: DISABLED_ENDPOINTS,
    threadServiceStatus: "unavailable",
    intelligenceStatus: "intelligence_not_enabled",
  },
] satisfies ReadonlyArray<{
  name: string;
  endpoints: ThreadEndpointRuntimeInfo | undefined;
  threadServiceStatus: string;
  intelligenceStatus: string;
}>;

test.each(lockedCapabilityCases)(
  "locked Threads reuse the local demo frame for $name without real routes",
  async (case_) => {
    const harness = await setupSettledState({
      endpoints: case_.endpoints,
      initialThreads: [realThread()],
      metadata: inspectorMetadata(
        "none",
        "enable_intelligence",
        "https://cloud.copilotkit.ai/actions/enable",
        {
          used: 0,
          limit: { kind: "finite", value: 200 },
          expiringSoonCount: 0,
        },
      ),
      runtimeLicense: "none",
    });
    try {
      const root = harness.inspector.shadowRoot!;
      const rows = harness.rows();

      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Realtime thread sync"),
        expect.stringContaining("Manage saved conversations"),
        expect.stringContaining("Inspect durable run history"),
      ]);
      expect(harness.threadList().threads.map((thread) => thread.id)).toEqual([
        "example-realtime-sync",
        "example-manage-history",
        "example-inspect-runs",
      ]);
      expect(harness.threadList().shadowRoot?.textContent).not.toContain(
        "Persisted support thread",
      );
      expect(root.textContent).toContain(
        "Enable Intelligence to inspect Threads.",
      );
      expect(
        root.querySelector(".cpk-threads-overview-video-frame"),
      ).not.toBeNull();
      expect(root.textContent).not.toContain("Learn how Threads work");
      expect(root.textContent).not.toContain(
        "Explore self-hosted Intelligence",
      );
      const action = root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="locked"]',
      );
      expect(action?.textContent?.trim()).toBe("Enable Intelligence");
      expect(action?.href).toBe("https://cloud.copilotkit.ai/actions/enable");
      expect(
        root.querySelector("[data-inspector-threads-footer]"),
      ).not.toBeNull();
      expect(root.textContent).toContain("0 / 200 Threads");
      expect(harness.routes()).toEqual(ZERO_ROUTES);
      const lockedEvents = telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsLockedViewed,
      );
      const exampleEvents = telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsExampleViewed,
      );
      expect(lockedEvents).toHaveLength(1);
      expect(lockedEvents[0]?.properties).toMatchObject({
        has_threads: false,
        usage_bucket: "empty",
        expiry_bucket: "zero",
        group_key: "threads",
        leaf_key: "threads",
        thread_service_status: case_.threadServiceStatus,
        intelligence_status: case_.intelligenceStatus,
        runtime_url_type: "remote",
        telemetry_disabled: false,
      });
      expect(exampleEvents).toHaveLength(3);
      expect(
        exampleEvents.map(({ properties }) => properties.example_kind),
      ).toEqual(["realtime_sync", "manage_history", "inspect_runs"]);
      expect(
        telemetryFor(
          harness.telemetryBodies,
          TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
        ),
      ).toEqual([]);

      await exerciseLocalExamples(harness, ZERO_ROUTES, "Locked");

      await harness.selectRow("Inspect durable run history");
      expect(root.textContent).toContain(
        "Enable Intelligence to inspect Threads.",
      );
      expect(harness.routes()).toEqual(ZERO_ROUTES);
    } finally {
      await harness.teardown();
    }
  },
);

type LockedActionCase = Readonly<{
  name: string;
  metadataState: "valid" | "none" | "expired" | "unknown";
  runtimeLicense: RuntimeLicenseStatus;
  actionKind?: "manage_plan" | "renew" | "enable_intelligence";
  actionUrl?: string;
  heading: string;
  bodyLabel?: string;
  footerLabel?: string;
}>;

const lockedActionCases: ReadonlyArray<LockedActionCase> = [
  {
    name: "valid manage action",
    metadataState: "valid",
    runtimeLicense: "valid",
    actionKind: "manage_plan",
    actionUrl: "https://cloud.copilotkit.ai/actions/manage",
    heading: "Threads are unavailable for this runtime.",
    footerLabel: "Manage Your Plan",
  },
  {
    name: "none enable action",
    metadataState: "none",
    runtimeLicense: "none",
    actionKind: "enable_intelligence",
    actionUrl: "https://cloud.copilotkit.ai/actions/enable",
    heading: "Enable Intelligence to inspect Threads.",
    bodyLabel: "Enable Intelligence",
  },
  {
    name: "expired renew action",
    metadataState: "expired",
    runtimeLicense: "expired",
    actionKind: "renew",
    actionUrl: "https://cloud.copilotkit.ai/actions/renew",
    heading: "Renew Intelligence to inspect Threads.",
    bodyLabel: "Renew",
  },
  {
    name: "expired manage action",
    metadataState: "expired",
    runtimeLicense: "expired",
    actionKind: "manage_plan",
    actionUrl: "https://cloud.copilotkit.ai/actions/manage-expired",
    heading: "Renew Intelligence to inspect Threads.",
    bodyLabel: "Manage Your Plan",
  },
  {
    name: "unknown action",
    metadataState: "unknown",
    runtimeLicense: "unknown",
    actionKind: "manage_plan",
    actionUrl: "https://cloud.copilotkit.ai/actions/unknown",
    heading: "Threads are unavailable.",
  },
  {
    name: "missing action",
    metadataState: "none",
    runtimeLicense: "none",
    heading: "Enable Intelligence to inspect Threads.",
  },
  {
    name: "unsafe matched action",
    metadataState: "none",
    runtimeLicense: "none",
    actionKind: "enable_intelligence",
    actionUrl: "javascript:alert(1)",
    heading: "Enable Intelligence to inspect Threads.",
  },
  {
    name: "known metadata Runtime conflict",
    metadataState: "none",
    runtimeLicense: "expired",
    actionKind: "enable_intelligence",
    actionUrl: "https://cloud.copilotkit.ai/actions/conflict",
    heading: "Renew Intelligence to inspect Threads.",
  },
];

test.each(lockedActionCases)(
  "locked action matrix keeps only the trusted $name",
  async (case_) => {
    const harness = await setupSettledState({
      endpoints: DISABLED_ENDPOINTS,
      initialThreads: [realThread()],
      metadata: inspectorMetadata(
        case_.metadataState,
        case_.actionKind,
        case_.actionUrl,
      ),
      runtimeLicense: case_.runtimeLicense,
      telemetryDisabled: true,
    });
    try {
      const root = harness.inspector.shadowRoot!;
      const bodyAction = root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="locked"]',
      );
      const footerAction = root.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );

      expect(root.textContent).toContain(case_.heading);
      expect(harness.rows()).toHaveLength(3);
      expect(bodyAction?.textContent?.trim()).toBe(case_.bodyLabel);
      expect(footerAction?.textContent?.trim()).toBe(case_.footerLabel);
      if (case_.bodyLabel) {
        expect(bodyAction?.href).toBe(case_.actionUrl);
        expect(bodyAction?.target).toBe("_blank");
        expect(bodyAction?.rel.split(/\s+/)).toContain("noopener");
      } else {
        expect(bodyAction).toBeNull();
      }
      if (case_.footerLabel) {
        expect(footerAction?.href).toBe(case_.actionUrl);
      } else {
        expect(footerAction).toBeNull();
      }
      await exerciseLocalExamples(harness, ZERO_ROUTES, case_.name);
      expect(harness.routes()).toEqual(ZERO_ROUTES);
    } finally {
      await harness.teardown();
    }
  },
);

const footerBodyStates = [
  "locked",
  "loading",
  "error",
  "zero",
  "real",
] as const satisfies ReadonlyArray<FooterBodyState>;

type FooterModuleCase = Readonly<{
  name: string;
  usage?: NonNullable<InspectorMetadataV1["usage"]>;
  action: boolean;
}>;

const footerModuleCases: ReadonlyArray<FooterModuleCase> = [
  {
    name: "usage only",
    usage: { used: 7, limit: { kind: "finite", value: 20 } },
    action: false,
  },
  { name: "action only", action: true },
  {
    name: "usage and action",
    usage: {
      used: 7,
      limit: { kind: "finite", value: 20 },
      expiringSoonCount: 0,
    },
    action: true,
  },
];

const footerCases = footerBodyStates.flatMap((state) =>
  footerModuleCases.map((module) => ({ state, module })),
);

test.each(footerCases)(
  "the $module.name footer stays last in the $state body",
  async ({ state, module }) => {
    const metadata = inspectorMetadata(
      "valid",
      module.action ? "manage_plan" : undefined,
      "https://cloud.copilotkit.ai/actions/footer",
      module.usage,
    );
    const harness = await setupFooterBody(state, metadata);
    try {
      const root = harness.inspector.shadowRoot!;
      const footers = root.querySelectorAll<HTMLElement>(
        "footer[data-inspector-threads-footer]",
      );
      const footer = footers[0];
      expect(footers).toHaveLength(1);
      expect(footer?.parentElement?.lastElementChild).toBe(footer);
      if (module.usage) {
        expect(footer?.textContent).toContain("7 / 20 Threads");
      } else {
        expect(
          footer?.querySelector("[data-inspector-thread-count]"),
        ).toBeNull();
      }
      const action = footer?.querySelector<HTMLAnchorElement>(
        '[data-inspector-action-placement="threads-footer"]',
      );
      if (module.action) {
        expect(action?.textContent?.trim()).toBe("Manage Your Plan");
        expect(action?.href).toBe("https://cloud.copilotkit.ai/actions/footer");
      } else {
        expect(action).toBeNull();
      }

      if (state === "locked") {
        expect(root.textContent).toContain(
          "Threads are unavailable for this runtime.",
        );
      }
      if (state === "loading") {
        expect(root.querySelector('[role="status"]')).not.toBeNull();
      }
      if (state === "error") {
        expect(root.querySelector('[role="alert"]')).not.toBeNull();
      }
      if (state === "zero") {
        expect(root.textContent).toContain(
          "Threads are persistent, inspectable conversations",
        );
      }
      if (state === "real") {
        expect(root.querySelector("cpk-thread-details")).not.toBeNull();
      }
    } finally {
      await harness.teardown();
    }
  },
);

test("a list error suppresses stale rows, details, examples, and state telemetry", async () => {
  const harness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [realThread()],
    listErrorAfterRows: "<img src=x> list failed",
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const listText = harness.threadList().shadowRoot?.textContent ?? "";
    const alert = root.querySelector('[role="alert"]');

    expect(harness.rows()).toEqual([]);
    expect(harness.threadList().threads).toEqual([]);
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Failed to load threads");
    expect(alert?.textContent).toContain("<img src=x> list failed");
    expect(alert?.querySelector("img")).toBeNull();
    expect(root.querySelector("cpk-thread-details")).toBeNull();
    expect(root.querySelector(".cpk-threads-overview-video-frame")).toBeNull();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(listText).not.toContain("Persisted support thread");
    expect(listText).not.toContain("Realtime thread sync");
    expect(listText).not.toContain("No threads yet");
    expect(root.textContent).not.toContain("See how Threads work");
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      ),
    ).toEqual([]);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEnabledViewed,
      ),
    ).toEqual([]);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsExampleViewed,
      ),
    ).toEqual([]);
    expect(harness.routes()).toEqual({ ...ZERO_ROUTES, list: 2 });
  } finally {
    await harness.teardown();
  }
});

test("enabled zero Threads keep all local data and tour paths off the network", async () => {
  const harness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [],
  });
  try {
    const root = harness.inspector.shadowRoot!;

    expect(harness.rows()).toHaveLength(3);
    expect(root.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(root.textContent).toContain("Learn how Threads work");
    expect(root.textContent).toContain("Explore self-hosted Intelligence");
    const routesAfterEmptyResult = harness.routes();
    expect(routesAfterEmptyResult).toEqual({ ...ZERO_ROUTES, list: 1 });
    await exerciseLocalExamples(
      harness,
      routesAfterEmptyResult,
      "Enabled-zero",
    );

    expect(harness.details()).not.toBeNull();
    expect(harness.routes()).toEqual(routesAfterEmptyResult);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      ),
    ).toHaveLength(1);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsExampleViewed,
      ),
    ).toHaveLength(3);
  } finally {
    await harness.teardown();
  }
});

test("enabled real Threads never mix in examples and keep the selected real detail", async () => {
  const older = {
    ...realThread("real-older"),
    name: "Older persisted thread",
    updatedAt: "2026-08-03T11:00:00.000Z",
  };
  const newest = {
    ...realThread("real-newest"),
    name: "Newest persisted thread",
    updatedAt: "2026-08-03T13:00:00.000Z",
  };
  const harness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [older, newest],
  });
  try {
    const root = harness.inspector.shadowRoot!;
    expect(harness.rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("Newest persisted thread"),
      expect.stringContaining("Older persisted thread"),
    ]);
    expect(harness.threadList().shadowRoot?.textContent).not.toContain(
      "Example",
    );
    expect(root.textContent).not.toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(harness.details()?.threadId).toBe("real-newest");
    expect(harness.details()?.provider).toBeNull();
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEnabledViewed,
      ),
    ).toHaveLength(1);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsExampleViewed,
      ),
    ).toEqual([]);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEmptyEnabledViewed,
      ),
    ).toEqual([]);

    await harness.selectRow("Older persisted thread");
    expect(harness.details()?.threadId).toBe("real-older");
    expect(harness.threadList().shadowRoot?.textContent).not.toContain(
      "Realtime thread sync",
    );
  } finally {
    await harness.teardown();
  }
});

test("a real-row refresh keeps the real list and selected detail visible", async () => {
  const thread = realThread();
  const harness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [thread],
    deferNextList: true,
  });
  try {
    const root = harness.inspector.shadowRoot!;
    const enabledEventsBefore = telemetryFor(
      harness.telemetryBodies,
      TELEMETRY_EVENTS.threadsEnabledViewed,
    );
    expect(harness.details()?.threadId).toBe(thread.id);
    expect(enabledEventsBefore).toHaveLength(1);

    harness.store.refresh();
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(harness.store.getState())).toBe(true);
    });
    await harness.flush();

    expect(harness.rows()).toHaveLength(1);
    expect(harness.rows()[0]?.textContent).toContain(thread.name);
    expect(harness.details()?.threadId).toBe(thread.id);
    expect(root.querySelector('[role="status"]')).toBeNull();
    expect(root.textContent).not.toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEnabledViewed,
      ),
    ).toHaveLength(enabledEventsBefore.length);

    harness.resolveDeferredList([thread]);
    await vi.waitFor(() => {
      expect(ɵselectThreadsIsLoading(harness.store.getState())).toBe(false);
    });
    await harness.flush();
    expect(harness.details()?.threadId).toBe(thread.id);
    expect(
      telemetryFor(
        harness.telemetryBodies,
        TELEMETRY_EVENTS.threadsEnabledViewed,
      ),
    ).toHaveLength(enabledEventsBefore.length);
  } finally {
    await harness.teardown();
  }
});

test("real and example rows expose native focus and current-selection semantics", async () => {
  const realHarness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [realThread()],
    telemetryDisabled: true,
  });
  try {
    const list = realHarness.threadList();
    const row = realHarness.rows()[0];
    expect(row).toBeInstanceOf(HTMLButtonElement);
    expect(row?.type).toBe("button");
    expect(row?.hasAttribute("role")).toBe(false);
    expect(row?.hasAttribute("tabindex")).toBe(false);
    expect(row?.tabIndex).toBe(0);
    expect(row?.textContent).toContain("Persisted support thread");
    row?.focus();
    expect(list.shadowRoot?.activeElement).toBe(row);
    expect(row?.getAttribute("aria-current")).toBe("true");

    const renderedStyle = list.shadowRoot?.querySelector("style")?.textContent;
    if (!renderedStyle) throw new Error("Thread list styles were not rendered");
    const parserStyle = document.createElement("style");
    parserStyle.textContent = renderedStyle;
    document.head.append(parserStyle);
    try {
      const styleRules = Array.from(parserStyle.sheet?.cssRules ?? []).filter(
        (rule): rule is CSSStyleRule => rule instanceof CSSStyleRule,
      );
      const rowRule = styleRules.find(
        (rule) => rule.selectorText === ".cpk-tl__item",
      );
      expect(rowRule?.style.appearance).toBe("none");
      expect(rowRule?.style.display).toBe("block");
      expect(rowRule?.style.width).toBe("100%");
      expect(rowRule?.style.textAlign).toBe("left");
      const focusRule = styleRules.find(
        (rule) => rule.selectorText === ".cpk-tl__item:focus-visible",
      );
      expect(focusRule?.style.outlineColor).toBe("rgb(85, 88, 178)");
      expect(focusRule?.style.outlineStyle).toBe("solid");
      expect(focusRule?.style.outlineWidth).toBe("2px");
      expect(focusRule?.style.outlineOffset).toBe("-2px");
      const timeRule = styleRules.find(
        (rule) => rule.selectorText === ".cpk-tl__time",
      );
      expect(timeRule?.style.color).toBe("rgb(104, 104, 110)");
      const examplePillRule = styleRules.find(
        (rule) => rule.selectorText === ".cpk-tl__pill--example",
      );
      expect(examplePillRule?.style.color).toBe("rgb(8, 118, 83)");
    } finally {
      parserStyle.remove();
    }
  } finally {
    await realHarness.teardown();
  }

  const exampleHarness = await setupSettledState({
    endpoints: ENABLED_ENDPOINTS,
    initialThreads: [],
    telemetryDisabled: true,
  });
  try {
    const list = exampleHarness.threadList();
    const firstRow = exampleHarness.rows()[0];
    expect(firstRow).toBeInstanceOf(HTMLButtonElement);
    expect(firstRow?.type).toBe("button");
    expect(firstRow?.tabIndex).toBe(0);
    expect(firstRow?.getAttribute("aria-current")).toBeNull();
    firstRow?.focus();
    expect(list.shadowRoot?.activeElement).toBe(firstRow);

    await exampleHarness.selectRow("Realtime thread sync");
    expect(exampleHarness.rows()[0]?.getAttribute("aria-current")).toBe("true");
    expect(
      exampleHarness
        .rows()
        .slice(1)
        .every((row) => !row.hasAttribute("aria-current")),
    ).toBe(true);
    await exampleHarness.selectRow("Realtime thread sync");
    expect(exampleHarness.rows()[0]?.getAttribute("aria-current")).toBeNull();
    expect(exampleHarness.inspector.shadowRoot?.textContent).toContain(
      "Threads are persistent, inspectable conversations",
    );
  } finally {
    await exampleHarness.teardown();
  }
});
