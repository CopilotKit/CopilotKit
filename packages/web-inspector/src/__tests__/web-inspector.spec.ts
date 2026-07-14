import {
  CpkThreadInspector,
  WebInspectorElement,
  ɵbuildCapabilityRows,
  ɵCpkThreadDetails,
} from "../index.js";
import type { ThreadDebuggerProvider } from "../index.js";
import type { CopilotKitCore } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
import type { Memory } from "@copilotkit/core";
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

type InspectorThreadViewInternals = {
  isOpen: boolean;
  selectedMenu: "ag-ui-events" | "threads";
  selectedThreadId: string | null;
  _threads: Array<{
    id: string;
    name?: string | null;
    agentId: string;
    updatedAt?: string | null;
  }>;
  _threadsByAgent: Map<
    string,
    Array<{
      id: string;
      name?: string | null;
      agentId: string;
      updatedAt?: string | null;
    }>
  >;
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
// The inspector calls core.getMemoryStore() lazily, on first Memories-tab
// activation (NOT on attach). All mock cores still expose this method so that
// tests which do activate the tab don't hit a TypeError. The stub below seeds
// the store with empty memories and available=true, which is the right default
// for tests that don't exercise the memory feature.

type MockMemoryStoreState = {
  memories: never[];
  isLoading: boolean;
  isMutating: boolean;
  error: null;
  context: null;
  sessionId: number;
  available: boolean;
  realtimeStatus: "connecting" | "connected" | "unavailable";
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
    realtimeStatus: "connecting",
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
// The timeline / state / raw-events panels each cache the rendered
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
  provider: ThreadDebuggerProvider | null;
  _fetchedMetadata: Record<string, unknown> | null;
  _conversation: Array<Record<string, unknown>>;
  agentEventsInput: Array<Record<string, unknown>>;
  _fetchedState: Record<string, unknown> | null;
  _fetchedEvents: Array<Record<string, unknown>> | null;
  _timelineItemsCache: {
    events: Array<Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
  } | null;
  _expandedTools: Set<string>;
  _expandedMessages: Set<string>;
  _expandedTimelineDetails: Set<string>;
  _stateNotAvailable: boolean;
  _eventsNotAvailable: boolean;
  _loadingMessages: boolean;
  _loadingState: boolean;
  _loadingEvents: boolean;
  activeTimelineItems: Array<Record<string, unknown>>;
  _panelTplCache: Map<string, { key: readonly unknown[]; tpl: unknown }>;
  fetchMessages: (threadId: string) => Promise<void>;
  fetchEvents: (threadId: string) => Promise<void>;
  fetchState: (threadId: string) => Promise<void>;
  renderTimeline: () => unknown;
  renderConversation: () => unknown;
  renderState: () => unknown;
  renderEvents: () => unknown;
  timelineItemsFromEvents: (
    events: Array<Record<string, unknown>>,
  ) => Array<Record<string, unknown>>;
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

function createThreadInspector(): {
  el: CpkThreadInspector;
  internals: ThreadDetailsInternals;
} {
  const el = new CpkThreadInspector();
  document.body.appendChild(el);
  const internals = el as unknown as ThreadDetailsInternals;
  return { el, internals };
}

async function flushProviderWork(el: CpkThreadInspector): Promise<void> {
  await Promise.resolve();
  await el.updateComplete;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

  it("threadId change drops template and timeline item caches", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    // Hand-build cache entries for all three panels so we don't have to
    // drive every render path through the DOM. The presence of any entry
    // is what the assertion below checks for; what they hold is irrelevant.
    internals._panelTplCache.set("timeline", { key: [], tpl: "c" });
    internals._panelTplCache.set("state", { key: [], tpl: "s" });
    internals._panelTplCache.set("raw-events", { key: [], tpl: "e" });
    internals.agentEventsInput = [
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {},
      },
    ];
    internals.renderTimeline();
    expect(internals._timelineItemsCache).not.toBeNull();

    // Switch to thread t2 — the threadId branch in `updated()` should
    // empty the cache map.
    internals.threadId = "t2";
    await el.updateComplete;

    expect(internals._panelTplCache.size).toBe(0);
    expect(internals._timelineItemsCache).toBeNull();
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

      const requestedUrls = fetchSpy.mock.calls.map((call) => String(call[0]));
      expect(requestedUrls).toContain(
        "http://localhost:4000/api/threads/thread%20one/messages",
      );
      expect(requestedUrls).toContain(
        "http://localhost:4000/api/threads/thread%20one/events",
      );
      expect(requestedUrls).toContain(
        "http://localhost:4000/api/threads/thread%20one/state",
      );
      expect(
        requestedUrls.every(
          (url) => !url.includes("/api//threads/") && !url.includes("one//"),
        ),
      ).toBe(true);
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
    expect(internals._panelTplCache.get("timeline-fallback")?.tpl).toBe(tplA);

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
    expect(internals._panelTplCache.get("timeline-fallback")?.tpl).toBe(tplB);
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

  it("keeps timeline and message fallback template caches separate", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    const events = [
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {},
        sourceIndex: 1,
      },
    ];
    internals._fetchedEvents = events;

    const timelineTpl = internals.renderTimeline();
    expect(internals._panelTplCache.get("timeline")?.tpl).toBe(timelineTpl);

    internals._fetchedEvents = [];
    internals._conversation = [
      { id: "m1", type: "user", content: "fallback", createdAt: "" },
    ];

    const fallbackTpl = internals.renderTimeline();
    expect(fallbackTpl).not.toBe(timelineTpl);
    expect(internals._panelTplCache.get("timeline")?.tpl).toBe(timelineTpl);
    expect(internals._panelTplCache.get("timeline-fallback")?.tpl).toBe(
      fallbackTpl,
    );

    internals._fetchedEvents = events;
    expect(internals.renderTimeline()).toBe(timelineTpl);
  });

  it("does not recompute timeline items when renderTimeline returns a cached template", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals._fetchedEvents = [
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {},
        sourceIndex: 1,
      },
    ];

    const normalizeSpy = vi.spyOn(internals, "timelineItemsFromEvents");

    const timelineTpl = internals.renderTimeline();

    expect(internals.renderTimeline()).toBe(timelineTpl);
    expect(normalizeSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps live fallback event references stable for timeline and raw event caches", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals.agentEventsInput = [
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {},
      },
    ];

    const normalizeSpy = vi.spyOn(internals, "timelineItemsFromEvents");

    const timelineTpl = internals.renderTimeline();
    const eventsTpl = internals.renderEvents();

    expect(internals.renderTimeline()).toBe(timelineTpl);
    expect(internals.renderEvents()).toBe(eventsTpl);
    expect(normalizeSpy).toHaveBeenCalledTimes(1);
  });

  it("state and events caches invalidate when their fetched data is reassigned", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    internals._fetchedState = { foo: "bar" };
    internals._fetchedEvents = [
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: {},
        sourceIndex: 1,
      },
    ];

    const stateA = internals.renderState();
    const eventsA = internals.renderEvents();
    expect(internals.renderState()).toBe(stateA);
    expect(internals.renderEvents()).toBe(eventsA);

    // Reassign both — fresh references after a refetch.
    internals._fetchedState = { foo: "baz" };
    internals._fetchedEvents = [
      {
        type: "RUN_FINISHED",
        timestamp: "2026-06-25T10:00:01.000Z",
        payload: {},
        sourceIndex: 1,
      },
    ];

    expect(internals.renderState()).not.toBe(stateA);
    expect(internals.renderEvents()).not.toBe(eventsA);
  });
});

describe("CpkThreadInspector provider contract", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the stable custom element and renders a normalized provider-backed timeline", async () => {
    expect(customElements.get("cpk-thread-inspector")).toBe(CpkThreadInspector);

    const provider: ThreadDebuggerProvider = {
      getThreadMetadata: vi.fn().mockResolvedValue({
        id: "thread-1234567890",
        agentId: "agent-a",
        endUserId: "user-a",
        status: "active",
        createdAt: "2026-06-25T10:00:00.000Z",
        updatedAt: "2026-06-25T10:00:01.000Z",
      }),
      getMessages: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { runId: "run-1" },
        },
        {
          type: "TEXT_MESSAGE_START",
          timestamp: "2026-06-25T10:00:00.100Z",
          payload: { messageId: "m1", role: "assistant" },
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          timestamp: "2026-06-25T10:00:00.200Z",
          payload: { messageId: "m1", delta: "hello from events" },
        },
        {
          type: "TOOL_CALL_START",
          timestamp: "2026-06-25T10:00:00.300Z",
          payload: { toolCallId: "tc1", toolCallName: "lookup_docs" },
        },
        {
          type: "TOOL_CALL_ARGS",
          timestamp: "2026-06-25T10:00:00.400Z",
          payload: { toolCallId: "tc1", delta: '{"broken":' },
        },
        {
          type: "TOOL_CALL_END",
          timestamp: "2026-06-25T10:00:00.500Z",
          payload: { toolCallId: "tc1" },
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-1234567890";
    await flushProviderWork(el);

    expect(provider.getThreadMetadata).toHaveBeenCalledWith(
      "thread-1234567890",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(provider.getEvents).toHaveBeenCalledWith(
      "thread-1234567890",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(provider.getMessages).not.toHaveBeenCalled();
    expect(internals._fetchedMetadata?.agentId).toBe("agent-a");
    expect(internals._fetchedEvents).toHaveLength(6);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Timeline");
    expect(text).toContain("Raw AG-UI Events");
    expect(text).toContain("State");
    expect(text).toContain("Run started");
    expect(text).toContain("assistant message");
    expect(text).toContain("hello from events");
    expect(text).toContain("lookup_docs");
    expect(text).toContain("Could not decode tool call arguments");
    expect(text).toContain("Source event #1");
    expect(text).toContain("Source event #6");
    expect(text).toContain("agent-a");
    expect(text).toContain("user-a");
    expect(text).not.toContain("Rename");
    expect(text).not.toContain("Archive");
    expect(text).not.toContain("Delete");
  });

  it("source-event references reveal raw events and state stays lazy-loaded", async () => {
    const provider: ThreadDebuggerProvider = {
      getMessages: vi.fn().mockResolvedValue([]),
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { runId: "run-1" },
        },
      ]),
      getState: vi.fn().mockResolvedValue({ step: 1 }),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-1";
    await flushProviderWork(el);

    expect(provider.getEvents).toHaveBeenCalledTimes(1);
    expect(provider.getState).not.toHaveBeenCalled();
    expect(internals._fetchedEvents?.[0]).toMatchObject({
      type: "RUN_STARTED",
      payload: { runId: "run-1" },
    });

    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__source-link")
      ?.click();
    await flushProviderWork(el);

    expect(
      el.shadowRoot?.querySelector<HTMLElement>(
        '.cpk-td__event[data-source-index="1"]',
      ),
    ).not.toBeNull();
    expect(provider.getEvents).toHaveBeenCalledTimes(1);

    el.shadowRoot
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[2]
      ?.click();
    await flushProviderWork(el);

    expect(provider.getState).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(internals._fetchedState).toEqual({ step: 1 });
  });

  it("reloads when a provider arrives after threadId and when provider identity swaps for the same thread", async () => {
    const firstEvents =
      createDeferred<
        Awaited<ReturnType<NonNullable<ThreadDebuggerProvider["getEvents"]>>>
      >();
    const firstSignals: AbortSignal[] = [];
    const firstProvider: ThreadDebuggerProvider = {
      getEvents: vi.fn((_threadId, options) => {
        firstSignals.push(options.signal);
        return firstEvents.promise;
      }),
    };
    const secondProvider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_FINISHED",
          timestamp: "2026-06-25T10:00:01.000Z",
          payload: { runId: "second-run" },
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.threadId = "thread-1";
    await flushProviderWork(el);

    expect(firstProvider.getEvents).not.toHaveBeenCalled();

    internals.provider = firstProvider;
    await flushProviderWork(el);

    expect(firstProvider.getEvents).toHaveBeenCalledWith(
      "thread-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    internals.provider = secondProvider;
    await flushProviderWork(el);

    expect(firstSignals[0]?.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(secondProvider.getEvents).toHaveBeenCalledWith(
        "thread-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(internals._fetchedEvents?.[0]?.type).toBe("RUN_FINISHED");
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        runId: "second-run",
      });
    });

    firstEvents.resolve([
      {
        type: "RUN_STARTED",
        timestamp: "2026-06-25T10:00:00.000Z",
        payload: { runId: "stale-run" },
      },
    ]);
    await Promise.resolve();

    expect(internals._fetchedEvents?.[0]?.payload).toEqual({
      runId: "second-run",
    });
  });

  it("renders raw AG-UI events with top-level fields preserved when payload is present", async () => {
    const provider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "TEXT_MESSAGE_CONTENT",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { messageId: "m1", delta: "hello" },
          runId: "top-level-run",
          sequence: 42,
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-raw";
    await flushProviderWork(el);

    expect(internals._fetchedEvents?.[0]?.payload).toEqual({
      messageId: "m1",
      delta: "hello",
    });
    expect(internals._fetchedEvents?.[0]?.rawEvent).toMatchObject({
      runId: "top-level-run",
      sequence: 42,
      payload: { messageId: "m1", delta: "hello" },
    });

    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__source-link")
      ?.click();
    await flushProviderWork(el);

    const rawEvent = el.shadowRoot?.querySelector<HTMLElement>(
      '.cpk-td__event[data-source-index="1"]',
    );
    expect(rawEvent?.textContent ?? "").toContain("Show details");
    expect(rawEvent?.textContent ?? "").not.toContain("top-level-run");
    expect(rawEvent?.textContent ?? "").not.toContain("sequence");
    expect(rawEvent?.textContent ?? "").not.toContain("messageId");
    expect(rawEvent?.textContent ?? "").not.toContain("hello");

    rawEvent
      ?.querySelector<HTMLButtonElement>(".cpk-td__timeline-details-toggle")
      ?.click();
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Hide details");
    expect(text).toContain("top-level-run");
    expect(text).toContain("sequence");
    expect(text).toContain("messageId");
    expect(text).toContain("hello");
  });

  it("ignores stale runtime 501 availability results after the selected thread changes", async () => {
    const t1Events = createDeferred<Response>();
    const t1State = createDeferred<Response>();
    const t2Events = createDeferred<Response>();
    const t2State = createDeferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/threads/t1/events")) return t1Events.promise;
      if (url.endsWith("/threads/t1/state")) return t1State.promise;
      if (url.endsWith("/threads/t2/events")) return t2Events.promise;
      if (url.endsWith("/threads/t2/state")) return t2State.promise;
      if (url.endsWith("/threads/t2/messages")) {
        return Promise.resolve(
          new Response(JSON.stringify({ messages: [] }), { status: 200 }),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { el, internals } = createThreadInspector();

    internals.runtimeUrl = "http://runtime";
    internals.threadInspectionAvailable = true;
    internals.threadId = "t1";
    await flushProviderWork(el);
    const t1StatePromise = internals.fetchState("t1");

    internals.threadId = "t2";
    await flushProviderWork(el);
    const t2StatePromise = internals.fetchState("t2");

    t1Events.resolve(new Response(null, { status: 501 }));
    t1State.resolve(new Response(null, { status: 501 }));
    t2Events.resolve(
      new Response(
        JSON.stringify({
          events: [
            {
              type: "RUN_STARTED",
              timestamp: "2026-06-25T10:00:00.000Z",
              payload: { runId: "fresh" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    t2State.resolve(
      new Response(JSON.stringify({ state: { current: "fresh" } }), {
        status: 200,
      }),
    );

    await Promise.all([t1StatePromise, t2StatePromise]);
    await vi.waitFor(() => {
      expect(internals._eventsNotAvailable).toBe(false);
      expect(internals._stateNotAvailable).toBe(false);
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        runId: "fresh",
      });
      expect(internals._fetchedState).toEqual({ current: "fresh" });
    });
  });

  it("refetches runtime thread data when headers change for the same thread", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: { headers?: Record<string, string> }) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              events: [
                {
                  type: "RUN_STARTED",
                  timestamp: "2026-06-25T10:00:00.000Z",
                  payload: {
                    auth: init?.headers?.Authorization,
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { el, internals } = createThreadInspector();

    internals.runtimeUrl = "http://runtime";
    internals.threadInspectionAvailable = true;
    internals.headers = { Authorization: "Bearer first" };
    internals.threadId = "thread-1";
    await flushProviderWork(el);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        auth: "Bearer first",
      });
    });

    internals.headers = { Authorization: "Bearer second" };
    await flushProviderWork(el);

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        auth: "Bearer second",
      });
    });
    expect(headersOf(fetchMock.mock.calls.at(-1)!)).toMatchObject({
      Authorization: "Bearer second",
    });
  });

  it("loads runtime messages when event history is empty so timeline fallback and counts work", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/threads/thread-1/events")) {
        return Promise.resolve(
          new Response(JSON.stringify({ events: [] }), { status: 200 }),
        );
      }
      if (url.endsWith("/threads/thread-1/messages")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              messages: [
                { id: "u1", role: "user", content: "historical hello" },
                { id: "a1", role: "assistant", content: "historical reply" },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected URL ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { el, internals } = createThreadInspector();

    internals.runtimeUrl = "http://runtime";
    internals.threadInspectionAvailable = true;
    internals.threadId = "thread-1";
    await flushProviderWork(el);

    await vi.waitFor(() => {
      expect(internals._fetchedEvents).toEqual([]);
      expect(internals._conversation).toHaveLength(2);
      expect(el.shadowRoot?.textContent ?? "").toContain("historical hello");
      expect(el.shadowRoot?.textContent ?? "").toContain("historical reply");
    });

    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__panel-toggle")
      ?.click();
    await flushProviderWork(el);

    expect(el.shadowRoot?.textContent ?? "").toContain("Messages");
    expect(el.shadowRoot?.textContent ?? "").toContain("2");
  });

  it("renders unsupported raw events as timeline rows instead of leaving the first tab empty", async () => {
    const provider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "THREAD_STATE_WRITTEN",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: { checkpointId: "state-1", status: "ok" },
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-raw-event-only";
    await flushProviderWork(el);

    expect(internals.activeTimelineItems).toHaveLength(1);
    expect(el.shadowRoot?.textContent ?? "").toContain("THREAD_STATE_WRITTEN");
    expect(el.shadowRoot?.textContent ?? "").toContain("Show details");
    expect(el.shadowRoot?.textContent ?? "").not.toContain("checkpointId");
    expect(el.shadowRoot?.textContent ?? "").toContain("Source event #1");
    expect(el.shadowRoot?.textContent ?? "").not.toContain(
      "No timeline events captured",
    );
    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__timeline-details-toggle")
      ?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.textContent ?? "").toContain("checkpointId");
  });

  it("collapses structured timeline event details by default", async () => {
    const provider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_STARTED",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: {
            input: {
              tools: [
                {
                  name: "generateSandboxedUi",
                  description: "very chonky run-started payload",
                },
              ],
            },
          },
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-chonky-run-started";
    await flushProviderWork(el);

    expect(el.shadowRoot?.textContent ?? "").toContain("Run started");
    expect(el.shadowRoot?.textContent ?? "").toContain("Show details");
    expect(el.shadowRoot?.textContent ?? "").not.toContain(
      "very chonky run-started payload",
    );
    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__timeline-details-toggle")
      ?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.textContent ?? "").toContain("Hide details");
    expect(el.shadowRoot?.textContent ?? "").toContain(
      "very chonky run-started payload",
    );
  });

  it("shows expanded timeline details when an event also has a summary body", async () => {
    const provider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([
        {
          type: "RUN_ERROR",
          timestamp: "2026-06-25T10:00:00.000Z",
          payload: {
            message: "Tool failed",
            errorCode: "ERR_TOOL_TIMEOUT",
          },
        },
      ]),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-error-details";
    await flushProviderWork(el);

    expect(el.shadowRoot?.textContent ?? "").toContain("Tool failed");
    expect(el.shadowRoot?.textContent ?? "").toContain("Show details");
    expect(el.shadowRoot?.textContent ?? "").not.toContain("ERR_TOOL_TIMEOUT");
    el.shadowRoot
      ?.querySelector<HTMLButtonElement>(".cpk-td__timeline-details-toggle")
      ?.click();
    await el.updateComplete;

    expect(el.shadowRoot?.textContent ?? "").toContain("Hide details");
    expect(el.shadowRoot?.textContent ?? "").toContain("ERR_TOOL_TIMEOUT");
  });

  it("keeps the first-visible timeline intentional while provider message fallback is loading", async () => {
    const messages =
      createDeferred<
        Awaited<ReturnType<NonNullable<ThreadDebuggerProvider["getMessages"]>>>
      >();
    const provider: ThreadDebuggerProvider = {
      getEvents: vi.fn().mockResolvedValue([]),
      getMessages: vi.fn().mockReturnValue(messages.promise),
    };
    const { el, internals } = createThreadInspector();

    internals.provider = provider;
    internals.threadId = "thread-messages-only";
    await flushProviderWork(el);

    expect(provider.getMessages).toHaveBeenCalledWith(
      "thread-messages-only",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(internals._loadingMessages).toBe(true);
    expect(el.shadowRoot?.textContent ?? "").toContain("Loading messages");
    expect(el.shadowRoot?.textContent ?? "").not.toContain(
      "No timeline events captured",
    );

    messages.resolve([
      { id: "u1", role: "user", content: "provider hello" },
      { id: "a1", role: "assistant", content: "provider reply" },
    ]);

    await vi.waitFor(() => {
      const text = el.shadowRoot?.textContent ?? "";
      expect(text).toContain("provider hello");
      expect(text).toContain("provider reply");
    });
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
  const threadListText = (inspector: WebInspectorElement) =>
    inspector.shadowRoot?.querySelector("cpk-thread-list")?.shadowRoot
      ?.textContent ?? "";
  const expectNoUtmParams = (url: URL) => {
    expect(url.searchParams.has("utm_source")).toBe(false);
    expect(url.searchParams.has("utm_medium")).toBe(false);
    expect(url.searchParams.has("utm_campaign")).toBe(false);
  };

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
    vi.useRealTimers();
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

  it("rerenders selected thread details so core header changes refetch events with new headers", async () => {
    fetchMock.mockImplementation(
      (url: string, init?: { headers?: Record<string, string> }) => {
        if (url.endsWith("/threads/thread-1/events")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                events: [
                  {
                    type: "RUN_STARTED",
                    timestamp: "2026-06-25T10:00:00.000Z",
                    payload: { csrf: init?.headers?.["X-CSRF"] },
                  },
                ],
              }),
              { status: 200 },
            ),
          );
        }
        if (url.includes("/threads?")) {
          return Promise.resolve(
            new Response(JSON.stringify({ threads: [] }), { status: 200 }),
          );
        }
        return Promise.reject(new Error(`Unexpected URL ${url}`));
      },
    );
    const harness = createHeaderMockCore({}, { "X-CSRF": "1" });
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];

    const internals = inspector as unknown as InspectorThreadViewInternals;
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals.selectedThreadId = "thread-1";
    internals._threads = [
      {
        id: "thread-1",
        name: "Thread 1",
        agentId: "alpha",
        updatedAt: "2026-06-25T10:00:00.000Z",
      },
    ];
    inspector.requestUpdate();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).endsWith("/threads/thread-1/events"),
        ),
      ).toHaveLength(1);
    });

    harness.emitHeadersChanged({ "X-CSRF": "2" });

    await vi.waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).endsWith("/threads/thread-1/events"),
        ),
      ).toHaveLength(2);
    });
    expect(headersOf(fetchMock.mock.calls.at(-1)!)).toMatchObject({
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
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    expect(engineer?.closest("#cpk-main-scroll")).toBeNull();
    expect(text).not.toContain("No threads yet");
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]).includes("/threads")),
    ).toBe(false);
  });

  it("adds inspector attribution to locked-state CTAs", async () => {
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
      'a[href^="https://dashboard.operations.copilotkit.ai/sign-in"]',
    );
    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );

    expect(signup).not.toBeNull();
    expect(engineer).not.toBeNull();

    const signupUrl = new URL(signup!.href);
    expect(signupUrl.origin).toBe("https://dashboard.operations.copilotkit.ai");
    expect(signupUrl.pathname).toBe("/sign-in");
    expect(signupUrl.searchParams.get("ref")).toBe("cpk-inspector");
    expectNoUtmParams(signupUrl);
    const distinctId = signupUrl.searchParams.get("posthog_distinct_id");
    expect(distinctId).toMatch(/^[0-9a-f-]{36}$/);

    const engineerUrl = new URL(engineer!.href);
    expect(engineerUrl.origin).toBe("https://www.copilotkit.ai");
    expect(engineerUrl.pathname).toBe("/talk-to-an-engineer");
    expect(engineerUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expectNoUtmParams(engineerUrl);
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

  it("renders example threads and the deselected overview when enabled thread history is empty", async () => {
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

    await vi.waitFor(() => {
      const text = threadListText(inspector);
      expect(text).toContain("Realtime thread sync");
      expect(text).toContain("Manage saved conversations");
      expect(text).toContain("Inspect durable run history");
    });

    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toContain("Threads are persistent, inspectable conversations");
    expect(text).toContain(
      "Take a tour with the example threads in the sidebar.",
    );
    const threadsDocs = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://docs.copilotkit.ai/threads"]',
    );
    expect(threadsDocs?.textContent?.trim()).toBe("Learn how Threads work");
    const threadsDocsUrl = new URL(threadsDocs!.href);
    expect(threadsDocsUrl.origin).toBe("https://docs.copilotkit.ai");
    expect(threadsDocsUrl.pathname).toBe("/threads");
    expect(threadsDocsUrl.searchParams.get("ref")).toBe(
      "cpk-inspector-threads",
    );
    expectNoUtmParams(threadsDocsUrl);
    const selfHosted = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://docs.copilotkit.ai/premium/self-hosting"]',
    );
    expect(selfHosted?.textContent?.trim()).toBe(
      "Explore self-hosted Intelligence",
    );
    const selfHostedUrl = new URL(selfHosted!.href);
    expect(selfHostedUrl.origin).toBe("https://docs.copilotkit.ai");
    expect(selfHostedUrl.pathname).toBe("/premium/self-hosting");
    expect(selfHostedUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expectNoUtmParams(selfHostedUrl);
    expect(threadListText(inspector)).toContain("Example");
    expect(text).not.toContain("No threads yet");
    expect(
      inspector.shadowRoot?.querySelector("cpk-thread-details"),
    ).toBeNull();
    expect(
      (inspector as unknown as InspectorThreadViewInternals).selectedThreadId,
    ).toBeNull();

    const engineer = inspector.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    const engineerUrl = new URL(engineer!.href);
    expect(engineerUrl.origin).toBe("https://www.copilotkit.ai");
    expect(engineerUrl.pathname).toBe("/talk-to-an-engineer");
    expect(engineerUrl.searchParams.get("ref")).toBe("cpk-inspector-threads");
    expectNoUtmParams(engineerUrl);
    expect(engineer?.closest("#cpk-main-scroll")).toBeNull();
  });

  it("defers loading the empty overview video until after the overview paints", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    expect(inspector.shadowRoot?.textContent ?? "").toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      inspector.shadowRoot?.querySelector(".cpk-threads-overview-video-frame"),
    ).not.toBeNull();
    expect(
      inspector.shadowRoot?.querySelector(".cpk-threads-overview-video"),
    ).toBeNull();

    await vi.advanceTimersByTimeAsync(450);
    await inspector.updateComplete;

    const video = inspector.shadowRoot?.querySelector<HTMLVideoElement>(
      ".cpk-threads-overview-video",
    );
    expect(video?.src).toBe(
      "https://cdn.copilotkit.ai/corp-site/videos/copilotkit-generative-ui-agentic-frontend-demo.webm",
    );
  });

  it("does not load the empty overview video when reduced motion is preferred", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    expect(inspector.shadowRoot?.textContent ?? "").toContain(
      "Threads are persistent, inspectable conversations",
    );
    expect(
      inspector.shadowRoot?.querySelector(".cpk-threads-overview-video-frame"),
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1200);
    await inspector.updateComplete;

    expect(
      inspector.shadowRoot?.querySelector(".cpk-threads-overview-video"),
    ).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deferred video timeout when disconnected before load", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: undefined,
    });
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    expect(vi.getTimerCount()).toBe(1);
    inspector.remove();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the deferred video idle callback when disconnected before load", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const requestIdleCallback = vi.fn(() => 123);
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: cancelIdleCallback,
    });

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    inspector.remove();
    expect(cancelIdleCallback).toHaveBeenCalledWith(123);
  });

  it("does not render example threads once real threads are present", async () => {
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = createHeaderMockCore({}, {}, {}, true)
      .core as unknown as WebInspectorElement["core"];

    const internals = inspector as unknown as InspectorThreadViewInternals;
    internals.isOpen = true;
    internals.selectedMenu = "threads";
    internals._threads = [
      {
        id: "real-thread",
        name: "Real customer thread",
        agentId: "alpha",
        updatedAt: "2026-06-25T10:00:00.000Z",
      },
    ];
    internals._threadsByAgent = new Map([["alpha", internals._threads]]);
    inspector.requestUpdate();
    await inspector.updateComplete;

    const text = threadListText(inspector);
    expect(text).toContain("Real customer thread");
    expect(text).not.toContain("Realtime thread sync");
    expect(text).not.toContain("Example");
  });

  it("selects an example thread, shows the tour, and toggles back to the overview on second click", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, true);

    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();

    const internals = inspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
      selectedThreadId: string | null;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("threads");
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const threadList = inspector.shadowRoot?.querySelector("cpk-thread-list");
    const firstRow =
      threadList?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    expect(firstRow).toBeDefined();

    firstRow!.click();
    await inspector.updateComplete;
    await vi.waitFor(() => {
      expect(internals.selectedThreadId).toBe("example-realtime-sync");
      expect(
        inspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).not.toBe(null);
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(internals.selectedThreadId).toBeNull();
      expect(
        inspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).toBeNull();
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Threads are persistent, inspectable conversations",
      );
    });
  });

  it("persists example tour dismissal so it does not auto-open again", async () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
      clear: () => stored.clear(),
      get length() {
        return stored.size;
      },
      key: (index: number) => Array.from(stored.keys())[index] ?? null,
    });

    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const firstRow = inspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    const skip = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Skip");
    expect(skip).toBeDefined();
    skip!.click();
    await inspector.updateComplete;

    expect(stored.get("cpk:inspector:threads-example-tour:v1")).toContain(
      '"dismissed":true',
    );

    const secondInspector = new WebInspectorElement();
    document.body.appendChild(secondInspector);
    secondInspector.core =
      harness.core as unknown as WebInspectorElement["core"];
    harness.emitAgentsChanged();
    const secondInternals = secondInspector as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: "threads") => void;
    };
    secondInternals.isOpen = true;
    secondInternals.handleMenuSelect("threads");
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(threadListText(secondInspector)).toContain("Realtime thread sync");
    });

    const secondRow = secondInspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    secondRow!.click();
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(
        secondInspector.shadowRoot?.querySelector("cpk-thread-details"),
      ).not.toBeNull();
    });
    expect(secondInspector.shadowRoot?.textContent ?? "").not.toContain(
      "Read the run as a story",
    );
    expect(secondInspector.shadowRoot?.textContent ?? "").toContain(
      "Show tour",
    );

    const showTour = Array.from(
      secondInspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        "button",
      ) ?? [],
    ).find((button) => button.textContent?.trim() === "Show tour");
    expect(showTour).toBeDefined();
    showTour!.click();
    await secondInspector.updateComplete;

    await vi.waitFor(() => {
      expect(secondInspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });
  });

  it("tracks example thread selection and tour dismissal telemetry", async () => {
    const { agent } = createMockAgent("alpha");
    const harness = createHeaderMockCore({ alpha: agent }, {}, {}, false);

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

    await vi.waitFor(() => {
      expect(threadListText(inspector)).toContain("Realtime thread sync");
    });

    const firstRow = inspector.shadowRoot
      ?.querySelector("cpk-thread-list")
      ?.shadowRoot?.querySelector<HTMLElement>(".cpk-tl__item");
    firstRow!.click();
    await inspector.updateComplete;

    await vi.waitFor(() => {
      expect(inspector.shadowRoot?.textContent ?? "").toContain(
        "Read the run as a story",
      );
    });

    const skip = Array.from(
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((button) => button.textContent?.trim() === "Skip");
    skip!.click();
    await inspector.updateComplete;

    const posts = telemetryPosts();
    expect(
      posts.some(
        (post) => post.event === "oss.inspector.threads_example_selected",
      ),
    ).toBe(true);
    expect(
      posts.some(
        (post) => post.event === "oss.inspector.threads_example_tour_started",
      ),
    ).toBe(true);
    const stepViewed = posts.find(
      (post) => post.event === "oss.inspector.threads_example_tour_step_viewed",
    );
    expect(stepViewed?.properties).toMatchObject({
      example_thread_id: "example-realtime-sync",
      tour_step: 1,
    });
    const dismissed = posts.find(
      (post) => post.event === "oss.inspector.threads_example_tour_dismissed",
    );
    expect(dismissed?.properties).toMatchObject({
      example_thread_id: "example-realtime-sync",
      dismiss_method: "skip",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Wave 6 — Memories tab + cpk-memory-list coverage
// ─────────────────────────────────────────────────────────────────────────
//
// 6.1  Helpers: makeCoreWithMemory / makeCoreNoIntelligence / mountMemories
// 6.2  Subscription: inspector._memories is seeded from store
// 6.3  Tab presence: "Learning" label appears in the rendered menu
// 6.4  View states: locked teaser vs. enabled empty vs. enabled with cards
// 6.5  cpk-memory-list: cards, kind filter, search filter, empty state
// 6.6  Passive guard: inspector reads from core.getMemoryStore(), never creates its own

// ── 6.1  Helpers ──────────────────────────────────────────────────────────

type MemoryStoreState = {
  memories: Memory[];
  isLoading: boolean;
  isMutating: boolean;
  error: Error | null;
  context: null;
  sessionId: number;
  available: boolean;
  realtimeStatus: "connecting" | "connected" | "unavailable";
};

/**
 * Returns a minimal mock memory store seeded with the given memories and
 * availability flag. The `select(selector)` method returns an Observable-like
 * that calls the subscriber once synchronously with the derived value, then
 * never again — sufficient for the inspector's subscription wiring.
 */
function makeMockMemoryStore(
  memories: Memory[],
  available: boolean,
  realtimeStatus: MemoryStoreState["realtimeStatus"] = "connected",
): { store: ReturnType<typeof buildStore>; state: MemoryStoreState } {
  const state: MemoryStoreState = {
    memories,
    isLoading: false,
    isMutating: false,
    error: null,
    context: null,
    sessionId: 0,
    available,
    realtimeStatus,
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
  telemetryDisabled: boolean;
  runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus;
  intelligence: { wsUrl: string } | undefined;
  subscribe: (subscriber: CopilotKitCoreSubscriber) => {
    unsubscribe: () => void;
  };
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
  memories: Memory[],
  opts: {
    available?: boolean;
    telemetryDisabled?: boolean;
    realtimeStatus?: MemoryStoreState["realtimeStatus"];
  } = {},
): MemoryMockCore {
  const available = opts.available ?? true;
  const { store } = makeMockMemoryStore(
    memories,
    available,
    opts.realtimeStatus ?? "connected",
  );

  return {
    agents: {},
    context: {},
    properties: {},
    telemetryDisabled: opts.telemetryDisabled ?? false,
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
    telemetryDisabled: false,
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
async function mountMemories(
  core: MemoryMockCore,
): Promise<WebInspectorElement> {
  const el = new WebInspectorElement();
  document.body.appendChild(el);
  // CopilotKitCore is a full class — our mock covers what the inspector reads.
  el.core = core as unknown as WebInspectorElement["core"];

  // Open the inspector window so the tab content is rendered.
  const internals = el as unknown as {
    isOpen: boolean;
    handleMenuSelect: (key: string) => void;
  };
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
      get length() {
        return 0;
      },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("seeds _memories from core.getMemoryStore() on Memories-tab activation", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    const ids = (el as unknown as { _memories: Memory[] })._memories.map(
      (m) => m.id,
    );

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
      get length() {
        return 0;
      },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a Learning tab button in the inspector menu", async () => {
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);

    const buttons = Array.from(
      el.shadowRoot?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    const memoriesButton = buttons.find((btn) =>
      btn.textContent?.trim().includes("Learning"),
    );

    expect(memoriesButton, "Learning tab button should render").toBeDefined();
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
      get length() {
        return 0;
      },
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
    expect(text).toContain(
      "Long-term memory isn't enabled on this deployment.",
    );
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list should NOT render when locked",
    ).toBeNull();
  });

  it("does not use Threads onboarding UTM attribution for locked memory CTAs", async () => {
    const core = makeCoreNoIntelligence();
    const el = await mountMemories(core);

    const talkToEngineer = el.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://www.copilotkit.ai/talk-to-an-engineer"]',
    );
    const signup = el.shadowRoot?.querySelector<HTMLAnchorElement>(
      'a[href^="https://go.copilotkit.ai/intelligence-signup"]',
    );

    expect(talkToEngineer).not.toBeNull();
    expect(signup).not.toBeNull();

    for (const href of [talkToEngineer!.href, signup!.href]) {
      const url = new URL(href);
      expect(url.searchParams.get("ref")).toBeTruthy();
      expect(url.searchParams.has("utm_source")).toBe(false);
      expect(url.searchParams.has("utm_medium")).toBe(false);
      expect(url.searchParams.has("utm_campaign")).toBe(false);
    }
  });

  it("renders the locked teaser when memories are unavailable", async () => {
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Long-term memory");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list should NOT render when unavailable",
    ).toBeNull();
  });

  it("renders cpk-memory-list with empty state when available and no memories", async () => {
    const core = makeCoreWithMemory([], { available: true });
    const el = await mountMemories(core);

    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list should render when enabled",
    ).not.toBeNull();

    await (memoryList as unknown as { updateComplete: Promise<void> })
      .updateComplete;
    const listText = memoryList?.shadowRoot?.textContent ?? "";
    expect(listText).toContain("No memories yet");
  });

  it("keeps the list rendered (not the full-screen error) when a mutation error arrives with memories present", async () => {
    // INSP-2: a failed remove/update sets the store error while a valid list is
    // already on screen. That must NOT blank the list with the full-screen
    // "Failed to load memories" state — the error is surfaced inline instead.
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);

    // Simulate a mutation failure landing after the list is rendered.
    (el as unknown as { _memoriesError: Error | null })._memoriesError =
      new Error("could not delete memory");
    el.requestUpdate();
    await el.updateComplete;

    // The list survives.
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list must remain rendered on a mutation error",
    ).not.toBeNull();

    const text = el.shadowRoot?.textContent ?? "";
    // Inline, non-blocking error with distinct copy.
    expect(text).toContain("Action failed: could not delete memory");
    // The full-screen load-failure copy must NOT appear.
    expect(text).not.toContain("Failed to load memories");
  });

  it("shows the full-screen load error only when no memories are loaded", async () => {
    // INSP-2 counterpart: a snapshot-load failure (empty list) still shows the
    // full-screen "Failed to load memories" state.
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);

    (el as unknown as { _memoriesError: Error | null })._memoriesError =
      new Error("network down");
    el.requestUpdate();
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Failed to load memories");
    expect(text).toContain("network down");
    expect(text).not.toContain("Action failed:");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(memoryList).toBeNull();
  });

  it("shows the 'live' indicator only when realtime is connected", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "connected",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("live");
    expect(text).not.toContain("offline");
    expect(text).not.toContain("reconnecting");
  });

  it("shows a muted 'reconnecting' indicator while realtime is connecting", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "connecting",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("reconnecting");
    // It must NOT claim "live" while still connecting.
    expect(text).not.toMatch(/>\s*live\s*</);
  });

  it("shows a muted 'offline' indicator when realtime has permanently given up", async () => {
    const core = makeCoreWithMemory([], {
      available: true,
      realtimeStatus: "unavailable",
    });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("offline");
    // The frozen snapshot must NOT be labelled "live".
    expect(text).not.toMatch(/>\s*live\s*</);
  });

  it("renders cpk-memory-list with a card when one memory is present", async () => {
    const oneMemory: Memory = {
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

    await (memoryList as unknown as { updateComplete: Promise<void> })
      .updateComplete;
    const cards = memoryList?.shadowRoot?.querySelectorAll(".cpk-ml__card");
    expect(cards?.length).toBe(1);
  });
});

// ── 6.5  cpk-memory-list ──────────────────────────────────────────────────

describe("cpk-memory-list", () => {
  const threeMemories: Memory[] = [
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
  async function mountList(memories: Memory[]): Promise<Element> {
    const el = document.createElement("cpk-memory-list");
    document.body.appendChild(el);
    // Assign memories via property (same as Lit's .memories=${...} binding).
    (el as unknown as { memories: Memory[] }).memories = memories;
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
    const contents = Array.from(cards ?? []).map((card) =>
      card.querySelector(".cpk-ml__content")?.textContent?.trim(),
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
    expect(
      operationalSeg,
      "operational filter segment should exist",
    ).not.toBeNull();

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
      get length() {
        return 0;
      },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls core.getMemoryStore() on tab activation and reads from the returned store", async () => {
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

  it("does NOT call core.getMemoryStore() merely by attaching the inspector", async () => {
    // INSP-1: getMemoryStore() lazily creates + starts the store and opens
    // realtime, so attaching the inspector must touch nothing. The store is
    // only created when the user activates the Memories tab.
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.appendChild(el);
    el.core = core as unknown as WebInspectorElement["core"];
    (el as unknown as { isOpen: boolean }).isOpen = true;
    await el.updateComplete;

    expect(spy).not.toHaveBeenCalled();

    // Activating the Memories tab is what creates + subscribes to the store.
    (
      el as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does not double-subscribe when the Memories tab is re-activated", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = await mountMemories(core);
    expect(spy).toHaveBeenCalledTimes(1);

    // Re-activate the Memories tab — the guard must prevent a second
    // getMemoryStore() call (which would create a second store/realtime).
    (
      el as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-subscribes after detach when the Memories tab is activated again", async () => {
    const core = makeCoreWithMemory([]);
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = await mountMemories(core);
    expect(spy).toHaveBeenCalledTimes(1);

    // Detach (core = null) must reset the lazy-subscription guard.
    el.core = null;
    await el.updateComplete;

    // Re-attach + re-activate the tab → a fresh subscription is created.
    el.core = core as unknown as WebInspectorElement["core"];
    (el as unknown as { isOpen: boolean }).isOpen = true;
    (
      el as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ── 6.6.1  Active-on-boot subscription ─────────────────────────────────────
//
// The memory subscription is normally created on a Memories-tab CLICK
// (handleMenuSelect → ensureMemorySubscription). But when the inspector boots
// with the Memories tab ALREADY active — e.g. a persisted
// `selectedMenu: "memories"` restored by hydrateStateFromStorageEarly — no
// click ever fires, so historically no subscription was created: the realtime
// indicator stayed stuck on the default "connecting" (rendered "reconnecting")
// and the list was empty until the user toggled tabs. The fix subscribes when
// the Memories tab is the active tab on boot, gated on the active tab so it
// still does not subscribe in apps not viewing memory (INSP-1).

describe("WebInspectorElement memories — active-on-boot subscription", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    // Persist `selectedMenu: "memories"` so hydrateStateFromStorageEarly (run in
    // connectedCallback, before any user interaction) restores the Memories tab
    // as the active tab — reproducing the stuck-indicator boot scenario.
    const store: Record<string, string> = {
      "cpk:inspector:state": JSON.stringify({ selectedMenu: "memories" }),
    };
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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("subscribes to the memory store on boot when the Memories tab is already active (no click)", async () => {
    // The store reports a live realtime status. If the inspector subscribes on
    // boot, _memoriesRealtimeStatus reflects "connected"; if it does NOT (the
    // bug), it stays on the default "connecting".
    const core = makeCoreWithMemory([], { realtimeStatus: "connected" });
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.appendChild(el);
    // connectedCallback has already restored selectedMenu = "memories".
    // Assigning core (the realistic boot path) must trigger the subscription
    // without any handleMenuSelect click.
    el.core = core as unknown as WebInspectorElement["core"];
    (el as unknown as { isOpen: boolean }).isOpen = true;
    await el.updateComplete;

    expect(
      (el as unknown as { selectedMenu: string }).selectedMenu,
      "persisted Memories tab should be the active tab on boot",
    ).toBe("memories");

    // The store was created + subscribed WITHOUT a tab click.
    expect(
      spy,
      "core.getMemoryStore() must be called on boot when Memories is active",
    ).toHaveBeenCalled();

    // The live status from the store is reflected — not the stuck default.
    expect(
      (el as unknown as { _memoriesRealtimeStatus: string })
        ._memoriesRealtimeStatus,
      "realtime status must reflect the store, not the default 'connecting'",
    ).toBe("connected");
  });

  it("does not double-subscribe when boot subscription is followed by a Memories-tab click", async () => {
    // The boot subscription must be idempotent: a later explicit click must not
    // create a second store/realtime connection.
    const core = makeCoreWithMemory([], { realtimeStatus: "connected" });
    const spy = vi.spyOn(core, "getMemoryStore");

    const el = new WebInspectorElement();
    document.body.appendChild(el);
    el.core = core as unknown as WebInspectorElement["core"];
    (el as unknown as { isOpen: boolean }).isOpen = true;
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);

    (
      el as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("memories");
    await el.updateComplete;

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ── 6.7  Older-core compat: missing getMemoryStore ────────────────────────
//
// An inspector attached to an older @copilotkit/core that predates
// getMemoryStore must not throw. The guard added in attachToCore must fall
// through to the else branch, set _memoriesAvailable = false, and leave the
// memories tab in the locked-teaser state — exactly like a core that defines
// the method but returns available=false.

describe("WebInspectorElement memories — older-core compat (no getMemoryStore)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() {
        return 0;
      },
      key: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when core lacks getMemoryStore, and renders the locked teaser", async () => {
    // Build a minimal core that does NOT define getMemoryStore — simulating an
    // older @copilotkit/core package. We deliberately omit the method rather
    // than setting it to undefined so the typeof guard fires correctly.
    const olderCore = {
      agents: {},
      context: {},
      properties: {},
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      // intelligence present so the only lock-cause is the missing store method
      intelligence: { wsUrl: "wss://localhost" },
      subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
        unsubscribe: () => undefined,
      }),
      getThreadStores: () => ({}),
      getThreadStore: (_agentId: string) => undefined,
      // getMemoryStore intentionally absent
    };

    const el = new WebInspectorElement();
    document.body.appendChild(el);

    // Assigning core must not throw even though getMemoryStore is missing.
    expect(() => {
      el.core = olderCore as unknown as WebInspectorElement["core"];
    }).not.toThrow();

    // Open and switch to the memories tab so the view state is rendered.
    const internals = el as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: string) => void;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    // The locked teaser must render — cpk-memory-list must NOT appear.
    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("Long-term memory");
    const memoryList = el.shadowRoot?.querySelector("cpk-memory-list");
    expect(
      memoryList,
      "cpk-memory-list must not render when getMemoryStore is absent",
    ).toBeNull();
  });

  it("shows the SDK-upgrade teaser (distinct from the not-enabled teaser) when getMemoryStore is absent", async () => {
    // INSP-3: an older @copilotkit/core (no getMemoryStore) must guide an SDK
    // upgrade, with copy distinct from the genuine "not enabled on this
    // deployment" teaser shown by a current SDK against a memory-less backend.
    const olderCore = {
      agents: {},
      context: {},
      properties: {},
      runtimeConnectionStatus: CopilotKitCoreRuntimeConnectionStatus.Connected,
      intelligence: { wsUrl: "wss://localhost" },
      subscribe: (_subscriber: CopilotKitCoreSubscriber) => ({
        unsubscribe: () => undefined,
      }),
      getThreadStores: () => ({}),
      getThreadStore: (_agentId: string) => undefined,
      // getMemoryStore intentionally absent
    };

    const el = new WebInspectorElement();
    document.body.appendChild(el);
    el.core = olderCore as unknown as WebInspectorElement["core"];
    const internals = el as unknown as {
      isOpen: boolean;
      handleMenuSelect: (key: string) => void;
    };
    internals.isOpen = true;
    internals.handleMenuSelect("memories");
    await el.updateComplete;

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain("@copilotkit SDK");
    expect(text).toContain("Upgrade");
    // Must NOT show the deployment-not-enabled copy in this case.
    expect(text).not.toContain(
      "Long-term memory isn't enabled on this deployment.",
    );
  });

  it("shows the not-enabled teaser (distinct from the upgrade teaser) when the current SDK reports memory unavailable", async () => {
    // INSP-3 counterpart: a current SDK (getMemoryStore present) whose store
    // reports available=false shows the deployment teaser, NOT upgrade copy.
    const core = makeCoreWithMemory([], { available: false });
    const el = await mountMemories(core);

    const text = el.shadowRoot?.textContent ?? "";
    expect(text).toContain(
      "Long-term memory isn't enabled on this deployment.",
    );
    expect(text).not.toContain("@copilotkit SDK");
  });
});

// ── 6.8  Memories tab telemetry gating (A7) + detach reset (A8) ────────────
//
// The memories tab is the only telemetry call site that must honor the host
// `core.telemetryDisabled` opt-out and must not re-fire on every click. These
// tests mirror the Threads tab-click telemetry test. They also cover that
// detachFromCore resets the memory view state so a later attach to an older
// core never leaks stale memory counts into telemetry.

describe("WebInspectorElement memories — tab telemetry + detach reset", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

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

  const memoriesTabClicks = () =>
    telemetryPosts().filter(
      (post) => post.event === "oss.inspector.memories_tab_clicked",
    );

  beforeEach(() => {
    document.body.innerHTML = "";
    // localStorage not opted out → track() proceeds to the fetch sink.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      get length() {
        return 0;
      },
      key: () => null,
    });
    fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts memories_tab_clicked when the Memories tab is selected", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    await mountMemories(core);
    await Promise.resolve();

    const clicks = memoriesTabClicks();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.properties).toMatchObject({
      memory_count: 1,
      available: true,
    });
  });

  it("does NOT post memories_tab_clicked when core.telemetryDisabled is true", async () => {
    const core = makeCoreWithMemory([], { telemetryDisabled: true });
    await mountMemories(core);
    await Promise.resolve();

    expect(memoriesTabClicks()).toHaveLength(0);
  });

  it("does not double-fire when the already-active Memories tab is re-selected", async () => {
    const core = makeCoreWithMemory([]);
    const el = await mountMemories(core);
    await Promise.resolve();

    // Re-select the already-active Memories tab.
    const internals = el as unknown as {
      handleMenuSelect: (key: string) => void;
    };
    internals.handleMenuSelect("memories");
    await el.updateComplete;
    await Promise.resolve();

    expect(memoriesTabClicks()).toHaveLength(1);
  });

  it("resets memory view state on detachFromCore (memories empty, count 0)", async () => {
    const oneMemory: Memory = {
      id: "m1",
      kind: "topical",
      scope: "user",
      content: "Likes dogs",
      sourceThreadIds: [],
      invalidatedAt: null,
    };

    const core = makeCoreWithMemory([oneMemory]);
    const el = await mountMemories(core);
    await Promise.resolve();

    // Sanity: the seeded memory is present before detach.
    expect(
      (el as unknown as { _memories: Memory[] })._memories.map((m) => m.id),
    ).toEqual(["m1"]);

    // Reassigning core triggers detachFromCore(); null means no re-attach.
    el.core = null;
    await el.updateComplete;

    const state = el as unknown as {
      _memories: Memory[];
      _memoriesLoading: boolean;
      _memoriesError: Error | null;
      _memoriesAvailable: boolean;
    };
    expect(state._memories).toEqual([]);
    expect(state._memories).toHaveLength(0);
    expect(state._memoriesLoading).toBe(false);
    expect(state._memoriesError).toBeNull();
    expect(state._memoriesAvailable).toBe(true);
  });
});

describe("ɵbuildCapabilityRows", () => {
  it("maps core.tools to rows, reflects isToolEnabled, and sorts by agentId then name", () => {
    const enabled = new Set(["b-tool"]);
    const core = {
      tools: [
        { name: "z-tool", agentId: "agent-2", description: "zed" },
        { name: "a-tool", agentId: "agent-1" },
        { name: "b-tool" },
      ],
      isToolEnabled: (name: string) => enabled.has(name),
    };
    const rows = ɵbuildCapabilityRows(core);
    expect(rows.map((r) => r.name)).toEqual(["b-tool", "a-tool", "z-tool"]);
    expect(rows[0]).toMatchObject({
      key: ":b-tool",
      name: "b-tool",
      agentId: undefined,
      enabled: true,
      fired: false,
    });
    expect(rows.find((r) => r.name === "a-tool")).toMatchObject({
      key: "agent-1:a-tool",
      enabled: false,
    });
    expect(rows.find((r) => r.name === "z-tool")).toMatchObject({
      description: "zed",
      enabled: false,
    });
  });

  it("passes isToolEnabled the tool's agentId (per-agent enablement)", () => {
    const calls: Array<[string, string | undefined]> = [];
    const core = {
      tools: [{ name: "t", agentId: "agent-x" }],
      isToolEnabled: (name: string, agentId?: string) => {
        calls.push([name, agentId]);
        return true;
      },
    };
    ɵbuildCapabilityRows(core);
    expect(calls).toEqual([["t", "agent-x"]]);
  });

  it("marks rows as fired when their key is in the fired set", () => {
    const core = { tools: [{ name: "t", agentId: "a" }], isToolEnabled: () => true };
    const rows = ɵbuildCapabilityRows(core, new Set(["a:t"]));
    expect(rows[0]?.fired).toBe(true);
  });

  it("returns an empty array when there are no tools", () => {
    expect(ɵbuildCapabilityRows({ tools: [], isToolEnabled: () => false })).toEqual([]);
    expect(ɵbuildCapabilityRows({ isToolEnabled: () => false })).toEqual([]);
  });
});

describe("WebInspectorElement Capabilities tab", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    });
  });

  function createCapabilitiesCore() {
    const toolEnabled: Record<string, boolean> = { greet: true, hide: true };
    const catalogEnabled: Record<string, boolean> = { Chart: true };
    const setToolEnabled = vi.fn(
      (name: string, enabled: boolean, _agentId?: string) => {
        toolEnabled[name] = enabled;
      },
    );
    const setCatalogComponentEnabled = vi.fn(
      (name: string, enabled: boolean) => {
        catalogEnabled[name] = enabled;
      },
    );
    const core = {
      agents: {},
      context: {},
      properties: {},
      runtimeConnectionStatus:
        CopilotKitCoreRuntimeConnectionStatus.Connected,
      subscribe: () => ({ unsubscribe: () => undefined }),
      getThreadStores: () => ({}),
      getThreadStore: () => undefined,
      getMemoryStore: () => ({
        getState: () => ({ available: true }),
        select: () => ({
          subscribe: (cb: (v: unknown) => void) => {
            cb(undefined);
            return { unsubscribe: () => undefined };
          },
        }),
      }),
      tools: [{ name: "greet", description: "Say hi" }, { name: "hide" }],
      isToolEnabled: (name: string) => toolEnabled[name] ?? true,
      setToolEnabled,
      catalogComponents: [{ name: "Chart", schema: {} }],
      isCatalogComponentEnabled: (name: string) => catalogEnabled[name] ?? true,
      setCatalogComponentEnabled,
    };
    return { core, setToolEnabled, setCatalogComponentEnabled };
  }

  it("shows the Capabilities tab and renders both sections", async () => {
    const { core } = createCapabilitiesCore();
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];
    (inspector as unknown as { isOpen: boolean }).isOpen = true;
    (
      inspector as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("capabilities");
    await inspector.updateComplete;
    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toContain("Frontend tools");
    expect(text).toContain("A2UI catalog components");
    expect(text).toContain("greet");
    expect(text).toContain("Chart");
  });

  it("calls setToolEnabled(false) when a tool switch is toggled off", async () => {
    const { core, setToolEnabled } = createCapabilitiesCore();
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];
    (inspector as unknown as { isOpen: boolean }).isOpen = true;
    (
      inspector as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("capabilities");
    await inspector.updateComplete;
    const switches =
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        'button[role="switch"]',
      ) ?? [];
    switches[0]?.click();
    await inspector.updateComplete;
    expect(setToolEnabled).toHaveBeenCalledWith("greet", false, undefined);
    const refreshed =
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        'button[role="switch"]',
      ) ?? [];
    expect(refreshed[0]?.getAttribute("aria-checked")).toBe("false");
  });

  it("calls setCatalogComponentEnabled when a catalog switch is toggled", async () => {
    const { core, setCatalogComponentEnabled } = createCapabilitiesCore();
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];
    (inspector as unknown as { isOpen: boolean }).isOpen = true;
    (
      inspector as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("capabilities");
    await inspector.updateComplete;
    const switches =
      inspector.shadowRoot?.querySelectorAll<HTMLButtonElement>(
        'button[role="switch"]',
      ) ?? [];
    switches[switches.length - 1]?.click();
    await inspector.updateComplete;
    expect(setCatalogComponentEnabled).toHaveBeenCalledWith("Chart", false);
  });

  it("hides the catalog section when catalogComponents is empty", async () => {
    const { core } = createCapabilitiesCore();
    (core as { catalogComponents: unknown[] }).catalogComponents = [];
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];
    (inspector as unknown as { isOpen: boolean }).isOpen = true;
    (
      inspector as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("capabilities");
    await inspector.updateComplete;
    const text = inspector.shadowRoot?.textContent ?? "";
    expect(text).toContain("Frontend tools");
    expect(text).not.toContain("A2UI catalog components");
  });

  it("marks a tool row as fired after its tool-call event", async () => {
    const { core } = createCapabilitiesCore();
    const inspector = new WebInspectorElement();
    document.body.appendChild(inspector);
    inspector.core = core as unknown as WebInspectorElement["core"];
    (inspector as unknown as { isOpen: boolean }).isOpen = true;
    (
      inspector as unknown as { firedCapabilities: Set<string> }
    ).firedCapabilities.add(":greet");
    (
      inspector as unknown as { handleMenuSelect: (k: string) => void }
    ).handleMenuSelect("capabilities");
    await inspector.updateComplete;
    expect(
      inspector.shadowRoot?.querySelector('[title="Fired this session"]'),
    ).not.toBeNull();
  });
});
