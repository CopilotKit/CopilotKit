import { CpkThreadInspector, ɵCpkThreadDetails } from "../../../index.js";
import type { ThreadDebuggerProvider } from "../../../index.js";
import { deferred } from "../../../testing/deferred.js";
import { textContentIncludingJson } from "../../../testing/inspector-elements.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  _eventsError: string | null;
  activeTimelineItems: Array<Record<string, unknown>>;
  _panelTplCache: Map<string, { key: readonly unknown[]; tpl: unknown }>;
  fetchMessages: (threadId: string) => Promise<void>;
  fetchEvents: (threadId: string) => Promise<void>;
  fetchState: (threadId: string) => Promise<void>;
  renderTimeline: () => unknown;
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
  // The cache slots have no public surface, so the test must reach through
  // a typed view of the element's private internals.
  const internals = el as unknown as ThreadDetailsInternals;
  return { el, internals };
}

function createThreadInspector(): {
  el: CpkThreadInspector;
  internals: ThreadDetailsInternals;
} {
  const el = new CpkThreadInspector();
  document.body.appendChild(el);
  // CpkThreadInspector keeps its loading and cache state private, so the
  // provider contract tests must reach through a typed view.
  const internals = el as unknown as ThreadDetailsInternals;
  return { el, internals };
}

async function flushProviderWork(el: CpkThreadInspector): Promise<void> {
  await Promise.resolve();
  await el.updateComplete;
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
    const originalConversation = internals._conversation;

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

    internals._conversation = originalConversation;
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

    const timelineTpl = internals.renderTimeline();
    const timelineItems = internals._timelineItemsCache?.items;

    expect(internals.renderTimeline()).toBe(timelineTpl);
    expect(internals._timelineItemsCache?.items).toBe(timelineItems);
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

    const timelineTpl = internals.renderTimeline();
    const timelineItems = internals._timelineItemsCache?.items;
    const eventsTpl = internals.renderEvents();

    expect(internals.renderTimeline()).toBe(timelineTpl);
    expect(internals.renderEvents()).toBe(eventsTpl);
    expect(internals._timelineItemsCache?.items).toBe(timelineItems);
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
    expect(provider.getMessages).toHaveBeenCalledTimes(1);
    expect(internals._fetchedMetadata?.agentId).toBe("agent-a");
    expect(internals._fetchedEvents).toHaveLength(6);

    const text = textContentIncludingJson(el.shadowRoot!);
    expect(text).toContain("Messages");
    expect(text).toContain("AG-UI Events");
    expect(text).toContain("State");
    expect(text).toContain("Run started");
    expect(text).toContain("Assistant message");
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

  it.each(["success", "rejection"] as const)(
    "ignores stale provider %s results after provider identity swaps for the same thread",
    async (staleOutcome) => {
      const firstEvents =
        deferred<
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

      if (staleOutcome === "success") {
        firstEvents.resolve([
          {
            type: "RUN_STARTED",
            timestamp: "2026-06-25T10:00:00.000Z",
            payload: { runId: "stale-run" },
          },
        ]);
      } else {
        firstEvents.reject(new Error("stale provider failure"));
      }
      await Promise.resolve();

      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        runId: "second-run",
      });
      expect(internals._eventsError).toBeNull();
    },
  );

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

    const text = textContentIncludingJson(el.shadowRoot!);
    expect(text).toContain("Hide details");
    expect(text).toContain("top-level-run");
    expect(text).toContain("sequence");
    expect(text).toContain("messageId");
    expect(text).toContain("hello");
  });

  it("ignores stale runtime 501 availability results after the selected thread changes", async () => {
    const t1Events = deferred<Response>();
    const t1State = deferred<Response>();
    const t2Events = deferred<Response>();
    const t2State = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/threads/t1/events")) return t1Events.promise;
      if (url.endsWith("/threads/t1/state")) return t1State.promise;
      if (url.endsWith("/threads/t2/events")) return t2Events.promise;
      if (url.endsWith("/threads/t2/state")) return t2State.promise;
      if (
        url.endsWith("/threads/t1/messages") ||
        url.endsWith("/threads/t2/messages")
      ) {
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

    // Count only thread-inspection requests. This stub replaces the global
    // fetch, so a fire-and-forget telemetry POST from an earlier case can land
    // here too; the assertion is about refetches, not total network calls.
    const threadFetches = () =>
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).startsWith("http://runtime"),
      );
    const eventFetches = () =>
      threadFetches().filter((call) => String(call[0]).endsWith("/events"));

    internals.runtimeUrl = "http://runtime";
    internals.threadInspectionAvailable = true;
    internals.headers = { Authorization: "Bearer first" };
    internals.threadId = "thread-1";
    await flushProviderWork(el);

    await vi.waitFor(() => {
      expect(eventFetches()).toHaveLength(1);
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        auth: "Bearer first",
      });
    });

    internals.headers = { Authorization: "Bearer second" };
    await flushProviderWork(el);

    await vi.waitFor(() => {
      expect(eventFetches()).toHaveLength(2);
      expect(internals._fetchedEvents?.[0]?.payload).toEqual({
        auth: "Bearer second",
      });
    });
    expect(eventFetches().at(-1)?.[1]?.headers).toMatchObject({
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
    expect(el.shadowRoot?.textContent ?? "").toContain("Thread state written");
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

    expect(textContentIncludingJson(el.shadowRoot!)).toContain("checkpointId");
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
    expect(textContentIncludingJson(el.shadowRoot!)).toContain(
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
    expect(textContentIncludingJson(el.shadowRoot!)).toContain(
      "ERR_TOOL_TIMEOUT",
    );
  });

  it("keeps the first-visible timeline intentional while provider message fallback is loading", async () => {
    const messages =
      deferred<
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
