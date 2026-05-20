import { WebInspectorElement, ɵCpkThreadDetails } from "../index";
import {
  CopilotKitCore,
  CopilotKitCoreRuntimeConnectionStatus,
  type CopilotKitCoreSubscriber,
} from "@copilotkit/core";
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
