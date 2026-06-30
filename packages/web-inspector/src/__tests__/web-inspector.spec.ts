import {
  CpkThreadInspector,
  WebInspectorElement,
  ɵCpkThreadDetails,
} from "../index.js";
import type { ThreadDebuggerProvider } from "../index.js";
import type { CopilotKitCore } from "@copilotkit/core";
import { CopilotKitCoreRuntimeConnectionStatus } from "@copilotkit/core";
import type { CopilotKitCoreSubscriber } from "@copilotkit/core";
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
  selectedMenu: "threads";
  selectedThreadId: string | null;
  _threads: Array<{
    id: string;
    name?: string | null;
    agentId: string;
    updatedAt?: string | null;
  }>;
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
  _fetchedState: Record<string, unknown> | null;
  _fetchedEvents: Array<Record<string, unknown>> | null;
  _expandedTools: Set<string>;
  _expandedMessages: Set<string>;
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

  it("threadId change drops all three template caches", async () => {
    const { el, internals } = createThreadDetails();
    await settleThread(el, internals, "t1");

    // Hand-build cache entries for all three panels so we don't have to
    // drive every render path through the DOM. The presence of any entry
    // is what the assertion below checks for; what they hold is irrelevant.
    internals._panelTplCache.set("timeline", { key: [], tpl: "c" });
    internals._panelTplCache.set("state", { key: [], tpl: "s" });
    internals._panelTplCache.set("raw-events", { key: [], tpl: "e" });

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

    const text = el.shadowRoot?.textContent ?? "";
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
    expect(el.shadowRoot?.textContent ?? "").toContain("checkpointId");
    expect(el.shadowRoot?.textContent ?? "").toContain("Source event #1");
    expect(el.shadowRoot?.textContent ?? "").not.toContain(
      "No timeline events captured",
    );
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
