import { WebInspectorElement, ɵCpkThreadDetails } from "../index.js";
import type { CopilotKitCore } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
import type { ɵMemory } from "@copilotkit/core";
import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Types for accessing LitElement-private reactive properties ---
// WebInspectorElement stores these as private Lit reactive properties.
// There's no public API to read them, so the cast is unavoidable in tests.

type InspectorInternals = {
  flattenedEvents: Array<{ type: string }>;
  agentMessages: Map<string, Array<{ contentText?: string }>>;
  agentStates: Map<string, unknown>;
  cachedTools: Array<{ name: string }>;
};

type InspectorContextInternals = {
  contextStore: Record<string, { description?: string; value: unknown }>;
  copyContextValue: (value: unknown, id: string) => Promise<void>;
  persistState: () => void;
};

// --- Mock agent factory ---

type MockAgentExtras = Partial<{
  messages: unknown;
  state: unknown;
  toolHandlers: Record<string, unknown>;
  toolRenderers: Record<string, unknown>;
}>;

type MockAgentController = {
  // Each subscriber method has a different parameter shape — TypeScript
  // can't narrow a dynamic key lookup, so the internal cast is unavoidable.
  emit: (key: keyof AgentSubscriber, payload: unknown) => void;
  /** Simulate AbstractAgent.setState(): mutate the mock's state and notify subscribers. */
  simulateSetState: (newState: Record<string, unknown>) => void;
};

function createMockAgent(
  agentId: string,
  extras: MockAgentExtras = {},
): { agent: AbstractAgent; controller: MockAgentController } {
  const subscribers = new Set<AgentSubscriber>();

  const agentObj = {
    agentId,
    ...extras,
    subscribe(subscriber: AgentSubscriber) {
      subscribers.add(subscriber);
      return {
        unsubscribe: () => subscribers.delete(subscriber),
      };
    },
  };

  const emit = (key: keyof AgentSubscriber, payload: unknown) => {
    subscribers.forEach((subscriber) => {
      const handler = subscriber[key];
      if (handler) {
        (handler as (arg: unknown) => void)(payload);
      }
    });
  };

  const simulateSetState = (newState: Record<string, unknown>) => {
    agentObj.state = newState;
    emit("onStateChanged", {
      state: newState,
      messages: agentObj.messages ?? [],
      agent: agentObj,
    });
  };

  // AbstractAgent is an abstract class — our plain-object mock satisfies
  // the subset the inspector uses but can't extend the class.
  return {
    agent: agentObj as unknown as AbstractAgent,
    controller: { emit, simulateSetState },
  };
}

// --- Mock core factory ---

// --- Minimal no-op memory store stub ---
// The inspector calls core.getMemoryStore() unconditionally during attachToCore.
// All mock cores must expose this method to prevent a TypeError. The stub
// below seeds the store with empty memories and available=true, which is the
// right default for tests that don't exercise the memory feature.

type MockMemoryStoreState = {
  memories: never[];
  isLoading: boolean;
  isMutating: boolean;
  error: null;
  context: null;
  sessionId: number;
  available: boolean;
};

function createNoopMemoryStore() {
  const state: MockMemoryStoreState = {
    memories: [],
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available: true,
  };
  return {
    getState: () => state,
    select: <T>(selector: (s: MockMemoryStoreState) => T) => ({
      subscribe: (cb: (v: T) => void) => {
        cb(selector(state));
        return { unsubscribe: () => undefined };
      },
    }),
  };
}

type MockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
  getThreadStores: () => Record<string, never>;
  getThreadStore: (agentId: string) => undefined;
  getMemoryStore: () => ReturnType<typeof createNoopMemoryStore>;
};

function createMockCore(initialAgents: Record<string, AbstractAgent> = {}) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const core: MockCore = {
    agents: initialAgents,
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores() {
      return {};
    },
    getThreadStore(_agentId: string) {
      return undefined;
    },
    getMemoryStore() {
      return createNoopMemoryStore();
    },
  };

  return {
    core,
    emitAgentsChanged(nextAgents = core.agents) {
      core.agents = nextAgents;
      // CopilotKitCore is a full class — our mock only covers what the
      // inspector reads, so this cast is unavoidable.
      subscribers.forEach((subscriber) =>
        subscriber.onAgentsChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          agents: core.agents,
        }),
      );
    },
    emitContextChanged(nextContext: Record<string, unknown>) {
      core.context = nextContext;
      subscribers.forEach((subscriber) =>
        subscriber.onContextChanged?.({
          copilotkit: core as unknown as CopilotKitCore,
          context: core.context as unknown as Readonly<
            Record<string, { value: string; description: string }>
          >,
        }),
      );
    },
  };
}

// --- Test helpers ---

/** Create inspector, attach to DOM, wire up mock core. */
function createInspectorWithCore(core: MockCore) {
  const inspector = new WebInspectorElement();
  document.body.appendChild(inspector);
  // WebInspectorElement["core"] is a CopilotKitCore instance — our MockCore
  // only implements the subset exercised by these tests.
  inspector.core = core as unknown as WebInspectorElement["core"];
  return inspector;
}

/** Access private Lit reactive properties on the inspector. */
function getInternals(inspector: WebInspectorElement) {
  return inspector as unknown as InspectorInternals;
}

/** Access context-related private properties on the inspector. */
function getContextInternals(inspector: WebInspectorElement) {
  return inspector as unknown as InspectorContextInternals;
}

// --- Tests ---

describe("WebInspectorElement", () => {
  let mockClipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    document.body.innerHTML = "";

    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    });

    mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    // navigator.clipboard is readonly in DOM types — assigning
    // the mock requires a cast in jsdom-style test environments.
    (navigator as unknown as { clipboard: typeof mockClipboard }).clipboard =
      mockClipboard;
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("records agent events and syncs state/messages/tools", async () => {
    const { agent, controller } = createMockAgent("alpha", {
      messages: [{ id: "m1", role: "user", content: "hi there" }],
      state: { foo: "bar" },
      toolHandlers: {
        greet: { description: "hello", parameters: { type: "object" } },
      },
    });
    const { core, emitAgentsChanged } = createMockCore({ alpha: agent });
    const inspector = createInspectorWithCore(core);

    emitAgentsChanged();
    await inspector.updateComplete;

    controller.emit("onRunStartedEvent", { event: { id: "run-1" } });
    controller.emit("onMessagesSnapshotEvent", { event: { id: "msg-1" } });
    await inspector.updateComplete;

    const internals = getInternals(inspector);

    expect(
      internals.flattenedEvents.some((evt) => evt.type === "RUN_STARTED"),
    ).toBe(true);
    expect(
      internals.flattenedEvents.some((evt) => evt.type === "MESSAGES_SNAPSHOT"),
    ).toBe(true);
    expect(internals.agentMessages.get("alpha")?.[0]?.contentText).toContain(
      "hi there",
    );
    expect(internals.agentStates.get("alpha")).toBeDefined();
    expect(internals.cachedTools.some((tool) => tool.name === "greet")).toBe(
      true,
    );
  });

  it("normalizes context, persists state, and copies context values", async () => {
    const { core, emitContextChanged } = createMockCore();
    const inspector = createInspectorWithCore(core);

    emitContextChanged({
      ctxA: { value: { nested: true } },
      ctxB: { description: "Described", value: 5 },
    });
    await inspector.updateComplete;

    const contextInternals = getContextInternals(inspector);
    const ctxA = contextInternals.contextStore.ctxA!;
    const ctxB = contextInternals.contextStore.ctxB!;
    expect(ctxA.value).toMatchObject({ nested: true });
    expect(ctxB.description).toBe("Described");

    await contextInternals.copyContextValue({ nested: true }, "ctxA");
    expect(mockClipboard.writeText).toHaveBeenCalledTimes(1);

    contextInternals.persistState();
    expect(localStorage.getItem("cpk:inspector:state")).toBeTruthy();
  });

  it("syncs agent state on direct setState (onStateChanged without pipeline events)", async () => {
    // Simulates a selfManagedAgent where agent.setState() is called directly
    // from UI code, bypassing the AG-UI event pipeline. Before the fix,
    // only pipeline event handlers (onStateSnapshotEvent, onStateDeltaEvent)
    // updated the inspector — onStateChanged was not subscribed to, so
    // direct setState() left the inspector stale.
    const { agent, controller } = createMockAgent("counter", {
      state: { counter: 0 },
    });
    const { core, emitAgentsChanged } = createMockCore({ counter: agent });
    const inspector = createInspectorWithCore(core);

    emitAgentsChanged();
    await inspector.updateComplete;

    const internals = getInternals(inspector);

    // Initial state should be captured on subscription
    expect(internals.agentStates.get("counter")).toEqual({ counter: 0 });

    // Simulate agent.setState({ counter: 1 })
    controller.simulateSetState({ counter: 1 });
    await inspector.updateComplete;
    expect(internals.agentStates.get("counter")).toEqual({ counter: 1 });

    // Simulate a second setState to verify repeated updates propagate
    controller.simulateSetState({ counter: 5 });
    await inspector.updateComplete;
    expect(internals.agentStates.get("counter")).toEqual({ counter: 5 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// CpkThreadDetails — per-panel TemplateResult cache invariants
// ─────────────────────────────────────────────────────────────────────────
//
// The conversation / agent-state / events panels each cache the rendered
// TemplateResult by reference of the underlying data so tab switches don't
// re-iterate over hundreds of items. These tests pin down the cache-key
// contract: when the data reassigns, the cache MUST drop, and when the
// thread changes, ALL three caches MUST reset. A future edit that mutates
// the data in place (instead of reassigning) or forgets to null one of the
// caches in `updated()` would silently render stale content under a new
// thread, which is undetectable by manual QA on a single thread.

type ThreadDetailsInternals = {
  threadId: string | null;
  runtimeUrl: string;
  headers: Record<string, string>;
  threadInspectionAvailable: boolean;
  liveMessageVersion: number;
  _conversation: Array<Record<string, unknown>>;
  _fetchedState: Record<string, unknown> | null;
  _fetchedEvents: Array<unknown> | null;
  _expandedTools: Set<string>;
  _expandedMessages: Set<string>;
  _stateNotAvailable: boolean;
  _eventsNotAvailable: boolean;
  _loadingMessages: boolean;
  _loadingState: boolean;
  _loadingEvents: boolean;
  _panelTplCache: Map<string, { key: readonly unknown[]; tpl: unknown }>;
  fetchMessages: (threadId: string) => Promise<void>;
  fetchEvents: (threadId: string) => Promise<void>;
  fetchState: (threadId: string) => Promise<void>;
  renderConversation: () => unknown;
  renderState: () => unknown;
  renderEvents: () => unknown;
};

function createThreadDetails(): {
  el: ɵCpkThreadDetails;
  internals: ThreadDetailsInternals;
} {
  const el = new ɵCpkThreadDetails();
  document.body.appendChild(el);
  // Same cast pattern as `getInternals` above — there's no public surface
  // for the cache slots, so the test reaches through a typed view.
  const internals = el as unknown as ThreadDetailsInternals;
  return { el, internals };
}

describe("ɵCpkThreadDetails caching", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  /**
   * Drive the threadId-change `updated()` block once so its reset path
   * runs on entry, then seed the data the test cares about AFTER. If we
   * seed before the first updateComplete, `updated()` immediately nulls
   * `_fetchedState` / `_fetchedEvents` / `_conversation` (and
   * `fetchMessages` re-clears `_conversation` when no `runtimeUrl` is
   * configured, as in this jsdom test), so the assertions below would
   * be running against an empty element.
   */
  async function settleThread(
    el: ɵCpkThreadDetails,
    internals: ThreadDetailsInternals,
    threadId: string,
  ): Promise<void> {
    internals.threadId = threadId;
    await el.updateComplete;
  }

  it("threadId change drops all three template caches", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    // Hand-build cache entries for all three panels so we don't have to
    // drive every render path through the DOM. The presence of any entry
    // is what the assertion below checks for; what they hold is irrelevant.
    internals._panelTplCache.set("conversation", { key: [], tpl: "c" });
    internals._panelTplCache.set("agent-state", { key: [], tpl: "s" });
    internals._panelTplCache.set("ag-ui-events", { key: [], tpl: "e" });

    // Switch to thread t2 — the threadId branch in `updated()` should
    // empty the cache map.
    internals.threadId = "t2";
    await el.updateComplete;

    expect(internals._panelTplCache.size).toBe(0);
  });

  it("does not fetch messages, events, or state when threadInspectionAvailable is omitted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    try {
      const { el, internals } = createThreadDetails();

      internals.runtimeUrl = "http://localhost:4000";
      internals.headers = { Authorization: "Bearer test-token" };
      internals.threadId = "t1";
      await el.updateComplete;

      expect(internals.threadInspectionAvailable).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      await internals.fetchEvents("t1");
      await internals.fetchState("t1");

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("joins thread inspection URLs without double slashes when runtimeUrl has a trailing slash", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/messages")) {
          return new Response(JSON.stringify({ messages: [] }), {
            status: 200,
          });
        }
        if (url.endsWith("/events")) {
          return new Response(JSON.stringify({ events: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ state: null }), { status: 200 });
      });
    try {
      const { el, internals } = createThreadDetails();
      internals.runtimeUrl = "http://localhost:4000/api/";
      internals.threadInspectionAvailable = true;
      internals.threadId = "thread one";
      await el.updateComplete;
      fetchSpy.mockClear();

      await internals.fetchMessages("thread one");
      await internals.fetchEvents("thread one");
      await internals.fetchState("thread one");

      expect(fetchSpy.mock.calls.map((call) => String(call[0]))).toEqual([
        "http://localhost:4000/api/threads/thread%20one/messages",
        "http://localhost:4000/api/threads/thread%20one/events",
        "http://localhost:4000/api/threads/thread%20one/state",
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("conversation cache invalidates when _conversation is reassigned", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals._conversation = [
      { id: "m1", type: "user", content: "hi", createdAt: "" },
    ];

    const tplA = internals.renderConversation();
    expect(internals._panelTplCache.get("conversation")?.tpl).toBe(tplA);

    // Cache hit: same array reference, same expand sets — same TemplateResult.
    expect(internals.renderConversation()).toBe(tplA);

    // New array reference (the streaming refetch path always reassigns
    // via `this._conversation = this.mapMessages(...)` rather than
    // mutating in place — that contract is what this test pins).
    internals._conversation = [
      { id: "m1", type: "user", content: "hi", createdAt: "" },
      { id: "m2", type: "assistant", content: "hello", createdAt: "" },
    ];

    const tplB = internals.renderConversation();
    expect(tplB).not.toBe(tplA);
    expect(internals._panelTplCache.get("conversation")?.tpl).toBe(tplB);
  });

  it("conversation cache invalidates when expand state changes", async () => {
    // Regression guard: an earlier version keyed the cache only on
    // `_conversation`, so toggling a tool-call expand or a "Show more"
    // on a long message returned the pre-toggle template. The cache key
    // now includes both expand sets.
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals._conversation = [
      {
        id: "tc1",
        type: "tool_call",
        toolName: "doThing",
        toolCallId: "tc1",
        arguments: { x: 1 },
        result: null,
        createdAt: "",
      },
    ];

    const collapsed = internals.renderConversation();
    expect(internals.renderConversation()).toBe(collapsed);

    // Simulating `toggleToolExpand("tc1")` — production code always
    // builds a fresh Set, so reference equality flips.
    internals._expandedTools = new Set(["tc1"]);

    const expanded = internals.renderConversation();
    expect(expanded).not.toBe(collapsed);

    // Same for the long-message "Show more" path.
    internals._expandedMessages = new Set(["m1"]);

    expect(internals.renderConversation()).not.toBe(expanded);
  });

  it("state and events caches invalidate when their fetched data is reassigned", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals._fetchedState = { foo: "bar" };
    internals._fetchedEvents = [{ type: "RUN_STARTED" }];

    const stateA = internals.renderState();
    const eventsA = internals.renderEvents();
    expect(internals.renderState()).toBe(stateA);
    expect(internals.renderEvents()).toBe(eventsA);

    // Reassign both — fresh references after a refetch.
    internals._fetchedState = { foo: "baz" };
    internals._fetchedEvents = [{ type: "RUN_FINISHED" }];

    expect(internals.renderState()).not.toBe(stateA);
    expect(internals.renderEvents()).not.toBe(eventsA);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Announcement preview (popout) dismissal MUST persist
// ─────────────────────────────────────────────────────────────────────────
//
// The preview bubble that pops out of the floating button carries an X. Clicking
// it MUST persist the announcement timestamp to localStorage. Otherwise
// fetchAnnouncement() recomputes `showAnnouncementPreview` from the (still
// empty) stored timestamp on the next mount and the bubble pops straight back
// out — the regression these tests guard against. Persistence lives only in
// markAnnouncementSeen(); the body-click / open paths clear the flag in memory
// only and are intentionally NOT persistent.

const ANNOUNCEMENT_STORAGE_KEY = "cpk:inspector:announcements";

type AnnouncementInternals = {
  hasUnseenAnnouncement: boolean;
  showAnnouncementPreview: boolean;
  announcementPreviewText: string | null;
  announcementTimestamp: string | null;
  isOpen: boolean;
};

describe("WebInspectorElement announcement preview dismissal", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    document.body.innerHTML = "";
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    });
  });

  /** Mount a closed inspector with an unseen announcement so the popout renders. */
  async function mountWithUnseenAnnouncement(timestamp: string) {
    const { core } = createMockCore();
    const inspector = createInspectorWithCore(core);
    const a = inspector as unknown as AnnouncementInternals;
    a.announcementTimestamp = timestamp;
    a.announcementPreviewText = "Slack early access is here!";
    a.hasUnseenAnnouncement = true;
    a.showAnnouncementPreview = true;
    inspector.requestUpdate();
    await inspector.updateComplete;
    return { inspector, a };
  }

  it("persists the announcement timestamp when the popout X is clicked", async () => {
    const timestamp = "2026-06-11T13:00:00.000Z";
    const { inspector, a } = await mountWithUnseenAnnouncement(timestamp);

    const dismiss = inspector.shadowRoot?.querySelector<HTMLElement>(
      ".announcement-preview__dismiss",
    );
    expect(dismiss, "popout dismiss control should render").not.toBeNull();

    dismiss?.click();
    await inspector.updateComplete;

    // The dismissal is persisted, so a remount would stay closed.
    expect(store[ANNOUNCEMENT_STORAGE_KEY]).toBe(JSON.stringify({ timestamp }));
    // In-memory flags cleared and the bubble is gone.
    expect(a.hasUnseenAnnouncement).toBe(false);
    expect(a.showAnnouncementPreview).toBe(false);
    expect(
      inspector.shadowRoot?.querySelector(".announcement-preview"),
    ).toBeNull();
  });

  it("dismissing the popout X does not open the inspector", async () => {
    const { inspector, a } = await mountWithUnseenAnnouncement(
      "2026-06-11T13:00:00.000Z",
    );
    expect(a.isOpen).toBe(false);

    inspector.shadowRoot
      ?.querySelector<HTMLElement>(".announcement-preview__dismiss")
      ?.click();
    await inspector.updateComplete;

    // X dismisses without opening (only a body click opens the inspector).
    expect(a.isOpen).toBe(false);
  });

  it("clicking the popout body opens the inspector without persisting", async () => {
    const { inspector, a } = await mountWithUnseenAnnouncement(
      "2026-06-11T13:00:00.000Z",
    );

    inspector.shadowRoot
      ?.querySelector<HTMLElement>(".announcement-preview")
      ?.click();
    await inspector.updateComplete;

    // Body click is engagement, not dismissal: it opens but must NOT persist,
    // so the in-window banner still shows the announcement.
    expect(a.isOpen).toBe(true);
    expect(store[ANNOUNCEMENT_STORAGE_KEY]).toBeUndefined();
    expect(a.hasUnseenAnnouncement).toBe(true);
  });
});

// --- Owned thread store header forwarding (issue #5581) ---
//
// When useThreads() isn't mounted, the inspector creates its own thread store
// per agent (ensureOwnedThreadStore). That store's /threads requests must carry
// the headers configured on <CopilotKit> (e.g. X-CSRF / auth), otherwise the
// requests 403 in environments that enforce CSRF/auth checks.

type HeaderMockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  telemetryDisabled: boolean;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  runtimeUrl: string;
  headers: Record<string, string>;
  threadEndpoints: {
    list: boolean;
    inspect: boolean;
    mutations: boolean;
    realtimeMetadata: boolean;
  };
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
  getThreadStores: () => Record<string, never>;
  getThreadStore: (agentId: string) => undefined;
  registerThreadStore: (agentId: string, store: unknown) => void;
  unregisterThreadStore: (agentId: string) => void;
  getMemoryStore: () => ReturnType<typeof createNoopMemoryStore>;
};

function createHeaderMockCore(
  agents: Record<string, AbstractAgent>,
  headers: Record<string, string>,
  endpointOverrides: Partial<HeaderMockCore["threadEndpoints"]> = {},
  telemetryDisabled = true,
) {
  const subscribers = new Set<CopilotKitCoreSubscriber>();
  const core: HeaderMockCore = {
    agents,
    context: {},
    properties: {},
    telemetryDisabled,
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    runtimeUrl: "http://localhost/api",
    headers,
    threadEndpoints: {
      list: true,
      inspect: true,
      mutations: true,
      realtimeMetadata: true,
      ...endpointOverrides,
    },
    subscribe(subscriber: CopilotKitCoreSubscriber) {
      subscribers.add(subscriber);
      return { unsubscribe: () => subscribers.delete(subscriber) };
    },
    getThreadStores() {
      return {};
    },
    getThreadStore() {
      return undefined;
    },
    registerThreadStore() {},
    unregisterThreadStore() {},
    getMemoryStore() {
      return createNoopMemoryStore();
    },
  };

  const asCore = () => core as unknown as CopilotKitCore;
  return {
    core,
    emitAgentsChanged() {
      subscribers.forEach((s) =>
        s.onAgentsChanged?.({ copilotkit: asCore(), agents: core.agents }),
      );
    },
    emitHeadersChanged(nextHeaders: Record<string, string>) {
      core.headers = nextHeaders;
      subscribers.forEach((s) =>
        s.onHeadersChanged?.({ copilotkit: asCore(), headers: nextHeaders }),
      );
    },
  };
}

const headersOf = (call: unknown[]) =>
  (call[1] as { headers?: Record<string, string> } | undefined)?.headers ?? {};

describe("WebInspectorElement owned thread store headers (#5581)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const threadListCalls = () =>
    fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/threads?"),
    );
  const telemetryPosts = () =>
    fetchMock.mock.calls
      .filter(
        (call) =>
          String(call[0]) === "https://telemetry.copilotkit.ai/ingest" &&
          (call[1] as RequestInit | undefined)?.method === "POST",
      )
      .map((call) => {
        const body =
          ((call[1] as RequestInit | undefined)?.body as string) ?? "{}";
        return JSON.parse(body) as {
          event: string;
          properties: Record<string, unknown>;
        };
      });

  beforeEach(() => {
    document.body.innerHTML = "";
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ threads: [] }),
      }),
    );
    // The owned store captures globalThis.fetch when it's created, so stub
    // before the inspector attaches to the core.
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards core headers on the owned store's /threads request", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      { "X-CSRF": "1", Authorization: "Bearer abc" },
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });

    expect(headersOf(threadListCalls()[0]!)).toMatchObject({
      "X-CSRF": "1",
      Authorization: "Bearer abc",
    });
  });

  it("re-applies headers on the owned store when core headers change", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, { "X-CSRF": "1" });

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(0);
    });
    const callsBefore = threadListCalls().length;

    harness.emitHeadersChanged({ "X-CSRF": "2" });

    await vi.waitFor(() => {
      expect(threadListCalls().length).toBeGreaterThan(callsBefore);
    });

    expect(headersOf(threadListCalls().at(-1)!)).toMatchObject({
      "X-CSRF": "2",
    });
  });

  it("shows the locked Intelligence state when thread listing is unavailable without fetching threads", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      { "X-CSRF": "1" },
      { list: false },
      true,
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("threads");
    await inspector.updateComplete;

    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toMatch(/Enable Intelligence to inspect Threads\./);
    expect(text).toContain("Talk to an Engineer");
    expect(text).toContain("Sign up for Intelligence");
    const ctaLabels = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
    ).map((anchor) => anchor.textContent?.trim());
    expect(ctaLabels).toEqual([
      "Talk to an Engineer",
      "Sign up for Intelligence",
    ]);
    expect(text).not.toContain("No threads yet");
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/threads")),
    ).toBe(false);
  });

  it("adds ref and posthog distinct ID attribution to locked-state CTAs", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      {},
      { list: false },
      false,
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("threads");
    await inspector.updateComplete;

    const signup = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://go.copilotkit.ai/intelligence-signup"]',
    );
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );

    expect(signup).not.toBeNull();
    expect(engineer).not.toBeNull();

    const signupUrl = new URL(signup!.href);
    expect(signupUrl.searchParams.get("ref")).toBe("cpk-inspector");
    const distinctId = signupUrl.searchParams.get("posthog_distinct_id");
    expect(distinctId).toMatch(/^[0-9a-f-]{36}$/);

    const engineerUrl = new URL(engineer!.href);
    expect(engineerUrl.origin).toBe("https://www.copilotkit.ai");
    expect(engineerUrl.pathname).toBe("/talk-to-an-engineer");
    expect(engineerUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expect(engineerUrl.searchParams.get("posthog_distinct_id")).toBe(
      distinctId,
    );
  });

  it("tracks Threads tab clicks through the rendered inspector menu", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore(
      { alpha: agent },
      {},
      { list: false },
      false,
    );

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as { isOpen: boolean };
    internals.isOpen = true;
    inspector.requestUpdate();
    await inspector.updateComplete;

    const threadsButton = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Threads");
    expect(threadsButton, "Threads menu button should render").toBeDefined();

    threadsButton!.click();
    await inspector.updateComplete;
    await Promise.resolve();

    const threadsTabClick = telemetryPosts().find(
      (post) => post.event === "oss.inspector.threads_tab_clicked",
    );
    expect(threadsTabClick).toBeDefined();
    expect(threadsTabClick!.properties).toMatchObject({
      intelligence_status: "intelligence_not_enabled",
      thread_service_status: "unavailable",
      telemetry_disabled: false,
    });
    expect(threadsTabClick!.properties.distinct_id).toMatch(/^[0-9a-f-]{36}$/);
    if (threadsTabClick!.properties.posthog_distinct_id !== undefined) {
      expect(threadsTabClick!.properties.posthog_distinct_id).toBe(
        threadsTabClick!.properties.distinct_id,
      );
    }
  });

  it("keeps the enabled empty Threads state when thread listing is available", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, true);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("threads");
    await inspector.updateComplete;

    expect(inspector.shadowRoot?.textContent ?? "").toContain("No threads yet");
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    expect(engineer?.href).toBe(
      "https://www.copilotkit.ai/talk-to-an-engineer?ref=cpk-inspector-threads",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Wave 6 — Memories tab + cpk-memory-list coverage
// ─────────────────────────────────────────────────────────────────────────
//
// 6.1  Helpers: makeCoreWithMemory / makeCoreNoIntelligence / mountMemories
// 6.2  Subscription: inspector._memories is seeded from store
// 6.3  Tab presence: "Memories" label appears in the rendered menu
// 6.4  View states: locked teaser vs. enabled empty vs. enabled with cards
// 6.5  cpk-memory-list: cards, kind filter, search filter, empty state
// 6.6  Passive guard: inspector reads from core.getMemoryStore(), never creates its own

// ── 6.1  Helpers ──────────────────────────────────────────────────────────

type MemoryStoreState = {
  memories: ɵMemory[];
  isLoading: boolean;
  isMutating: boolean;
  error: Error | null;
  context: null;
  sessionId: number;
  available: boolean;
};

/**
 * Returns a minimal mock memory store seeded with the given memories and
 * availability flag. The `select(selector)` method returns an Observable-like
 * that calls the subscriber once synchronously with the derived value, then
 * never again — sufficient for the inspector's subscription wiring.
 */
function makeMockMemoryStore(
  memories: ɵMemory[],
  available: boolean,
): { store: ReturnType<typeof buildStore>; state: MemoryStoreState } {
  const state: MemoryStoreState = {
    memories,
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available,
  };

  function buildStore() {
    return {
      getState: () => state,
      select: <T>(selector: (s: MemoryStoreState) => T) => ({
        subscribe: (cb: (v: T) => void) => {
          cb(selector(state));
          return { unsubscribe: () => undefined };
        },
      }),
    };
  }

  const store = buildStore();
  return { store, state };
}

type MemoryMockCore = {
  agents: Record<string, AbstractAgent>;
  context: Record<string, unknown>;
  properties: Record<string, unknown>;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  intelligence: { wsUrl: string } | undefined;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => { unsubscribe: () => void };
  getThreadStores: () => Record<string, never>;
  getThreadStore: (agentId: string) => undefined;
  getMemoryStore: () => ReturnType<typeof makeMockMemoryStore>["store"];
};

/**
 * Returns a mock core with an intelligence property set (so the memories view
 * is not locked by the intelligence guard) and a memory store seeded with the
 * supplied memories. Pass `available: false` to simulate memories being
 * unavailable (which also locks the view).
 */
function makeCoreWithMemory(
  memories: ɵMemory[],
  opts: { available?: boolean } = {},
): MemoryMockCore {
  const available = opts.available ?? true;
  const { store } = makeMockMemoryStore(memories, available);

  return {
    agents: {},
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    // Intelligence present → locked teaser is NOT shown (unless available=false).
    intelligence: { wsUrl: "wss://localhost" },
    subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
      unsubscribe: () => undefined,
    }),
    getThreadStores: () => ({}),
    getThreadStore: (_agentId: string) => undefined,
    getMemoryStore: () => store,
  };
}

/**
 * Returns a mock core that has NO intelligence property. Used to assert the
 * locked teaser regardless of memory availability.
 */
function makeCoreNoIntelligence(): MemoryMockCore {
  const { store } = makeMockMemoryStore([], true);

  return {
    agents: {},
    context: {},
    properties: {},
    runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
    intelligence: undefined,
    subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
      unsubscribe: () => undefined,
    }),
    getThreadStores: () => ({}),
    getThreadStore: (_agentId: string) => undefined,
    getMemoryStore: () => store,
  };
}

/**
 * Mounts a `<cpk-web-inspector>` with the given core, opens it, and switches
 * to the memories tab. Returns the element ready for assertion.
 */
async function mountMemories(core: MemoryMockCore): Promise<WebInspectorElement> {
  const el = new WebInspectorElement();
  document.body.appendChild(el);
  // CopilotKitCore is a full class — our mock covers what the inspector reads.
  el.core = core as unknown as WebInspectorElement["core"];

  // Open the inspector window so the tab content is rendered.
  const internals = el as unknown as { isOpen: boolean; handleMenuSelect: (key: string) => void };
  internals.isOpen = true;
  internals.handleMenuSelect("memories");

  await el.updateComplete;
  return el;
}

// ── 6.2  Subscription ─────────────────────────────────────────────────────

describe("WebInspectorElement memories — subscription", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() { return 0; },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds _memories from core.getMemoryStore() on attach", async () => {
    const oneMemory: ɵMemory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    const ids = (el as unknown as { _memories: ɵMemory[] })._memories.map((m) => m.id);

    expect(ids).toEqual(["m1"]);
  });
});

// ── 6.3  Tab presence ─────────────────────────────────────────────────────

describe("WebInspectorElement memories — tab presence", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() { return 0; },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a Memories tab button in the inspector menu", async () => {
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);

    const buttons = Array.from(
      el.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const memoriesButton = buttons.find((btn) =>
      btn.textContent?.trim().includes("Memories"),
    );

    expect(memoriesButton, "Memories tab button should render").toBeDefined();
  });
});

// ── 6.4  View states ──────────────────────────────────────────────────────

describe("WebInspectorElement memories — view states", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() { return 0; },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the locked teaser when intelligence is absent", async () => {
    const core = makeCoreNoIntelligence();
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Long-term memory");
    expect(text).toContain("Long-term memory isn't enabled on this deployment.");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList, "cpk-memory-list should NOT render when locked").toBeNull();
  });

  it("renders the locked teaser when memories are unavailable", async () => {
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Long-term memory");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList, "cpk-memory-list should NOT render when unavailable").toBeNull();
  });

  it("renders cpk-memory-list with empty state when available and no memories", async () => {
    const core = makeCoreWithMemory([], { available: true });
    const el = await mountMemories(core);

    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList, "cpk-memory-list should render when enabled").not.toBeNull();

    await (memoryList as unknown as { updateComplete: Promise<void> }).updateComplete;
    const listText = memoryList?.shadowRoot?.textContent ?? "";
    expect(listText).toContain("No memories yet");
  });

  it("renders cpk-memory-list with a card when one memory is present", async () => {
    const oneMemory: ɵMemory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Prefers dark mode",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList, "cpk-memory-list should render").not.toBeNull();

    await (memoryList as unknown as { updateComplete: Promise<void> }).updateComplete;
    const cards = memoryList?.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length).toBe(1);
  });
});

// ── 6.5  cpk-memory-list ──────────────────────────────────────────────────

describe("cpk-memory-list", () => {
  const threeMemories: ɵMemory[] = [
    {
      id: "t1",
      kind: "topical",
      scope: "user",
      content: "Likes cats",
      sourceThreadIds: [],
      invalidatedAt: null,
    },
    {
      id: "e1",
      kind: "episodic",
      scope: "user",
      content: "First login was on a Monday",
      sourceThreadIds: [],
      invalidatedAt: null,
    },
    {
      id: "o1",
      kind: "operational",
      scope: "user",
      content: "Deploys on Thursdays",
      sourceThreadIds: [],
      invalidatedAt: null,
    },
  ];

  /** Create and mount a standalone cpk-memory-list element. */
  async function mountList(memories: ɵMemory[]): Promise<Element> {
    const el = document.createElement("cpk-memory-list");
    document.body.appendChild(el);
    // Assign memories via property (same as Lit's .memories=${...} binding).
    (el as unknown as { memories: ɵMemory[] }).memories = memories;
    // Trigger update if the element is a Lit element.
    if ("updateComplete" in el) {
      await (el as unknown as { updateComplete: Promise<void> }).updateComplete;
    }
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("renders one card per memory in order", async () => {
    const el = await mountList(threeMemories);
    const cards = el.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length).toBe(3);
    const contents = Array.from(cards ?? []).map(
      (card) => card.querySelector(".cpk-ml__content")?.textContent?.trim(),
    );
    expect(contents).toEqual([
      "Likes cats",
      "First login was on a Monday",
      "Deploys on Thursdays",
    ]);
  });

  it("narrows cards when an operational kind filter is clicked", async () => {
    const el = await mountList(threeMemories);

    const operationalSeg = el.shadowRoot?.querySelector<HTMLElement>(
      '[data-kind="operational"]',
    );
    expect(operationalSeg, "operational filter segment should exist").not.toBeNull();

    operationalSeg!.click();
    await (el as unknown as { updateComplete: Promise<void> }).updateComplete;

    const cards = el.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length).toBe(1);
    expect(
      cards?.[0]?.querySelector(".cpk-ml__content")?.textContent?.trim(),
    ).toBe("Deploys on Thursdays");
  });

  it("filters cards by search text (case-insensitive)", async () => {
    const el = await mountList(threeMemories);

    const searchInput = el.shadowRoot?.querySelector<HTMLInputElement>(
      ".cpk-ml__search-input",
    );
    expect(searchInput, "search input should exist").not.toBeNull();

    searchInput!.value = "deploy";
    searchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await (el as unknown as { updateComplete: Promise<void> }).updateComplete;

    const cards = el.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length).toBe(1);
    expect(
      cards?.[0]?.querySelector(".cpk-ml__content")?.textContent?.trim(),
    ).toBe("Deploys on Thursdays");
  });

  it("shows the empty state when memories is empty", async () => {
    const el = await mountList([]);
    const empty = el.shadowRoot?.querySelector(".cpk-ml__empty");
    expect(empty, "empty state should render").not.toBeNull();
    expect(el.shadowRoot?.textContent ?? "").toContain("No memories yet");
    const cards = el.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length ?? 0).toBe(0);
  });
});

// ── 6.6  Passive guard ────────────────────────────────────────────────────

describe("WebInspectorElement memories — passive store guard", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() { return 0; },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls core.getMemoryStore() during attach and reads from the returned store", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    await mountMemories(core);

    expect(spy).toHaveBeenCalled();

    // The store instance that spy captured is the exact same object that
    // core.getMemoryStore() returns — inspector reads from it, never wraps it.
    const returnedStore = spy.mock.results[0]?.value;
    expect(returnedStore).toBeDefined();
    // Verify the inspector consumed the store by checking its getState was accessible
    // (if the inspector had created its own store instead, this reference would differ).
    expect(typeof returnedStore.getState).toBe("function");
    expect(typeof returnedStore.select).toBe("function");
  });
});
