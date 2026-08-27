import type { ɵThread } from "@copilotkit/core";
import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type {
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
} from "../../../shared/thread-debugger/types.js";
import { PortableLitElement } from "../../../ui/portable-lit-element.js";
import { renderConversationItems } from "./conversation-view.js";
import { adaptThreadEvents } from "./event-adapter.js";
import type { ApiAgentEvent } from "./event-adapter.js";
import { renderThreadEventsView } from "./events-view.js";
import {
  adaptThreadMessages,
  groupConversationItems,
} from "./message-adapter.js";
import type {
  ConversationAssistant,
  ConversationGenerativeUIItem,
  ConversationItem,
  ConversationRenderItem,
  ConversationToolCall,
  ConversationUser,
  ToolCallGroup,
} from "./message-adapter.js";
import {
  canLoadThreadResource,
  createHeadersLoadKey,
  createProviderLoadKey,
  getThreadInspectionUrl,
} from "./provider.js";
import { renderThreadStateView } from "./state-view.js";
import { createTimelineItems } from "./timeline-model.js";
import type { TimelineItem } from "./timeline-model.js";
import { renderTimelineItems } from "./timeline-view.js";
import { threadInspectorStyles } from "./thread-inspector.styles.js";

const EMPTY_INSPECTOR_MESSAGES: ReadonlyArray<{
  id?: string;
  role: string;
  contentText: string;
}> = [];

export type ThreadDetailsTab = "timeline" | "state" | "raw-events";
type ThreadDetailsPanelCacheSlot = ThreadDetailsTab | "timeline-fallback";

type RuntimeEventsFetchResult =
  | { status: "available"; events: ThreadDebuggerEvent[] }
  | { status: "not-available" };

type RuntimeStateFetchResult =
  | { status: "available"; state: Record<string, unknown> | null }
  | { status: "not-available" };

// ─── cpk-thread-inspector ────────────────────────────────────────────────────
// Renders the selected thread's read-only timeline, state, raw AG-UI events,
// and compact technical metadata. External hosts provide a ThreadDebuggerProvider;
// the legacy CopilotKit Inspector wrapper can still pass runtime URL inputs.
export class CpkThreadInspector extends PortableLitElement {
  static properties = {
    threadId: { attribute: false },
    provider: { attribute: false },
    thread: { attribute: false },
    runtimeUrl: { attribute: false },
    headers: { attribute: false },
    threadInspectionAvailable: { attribute: false },
    agentStateInput: { attribute: false },
    agentEventsInput: { attribute: false },
    agentMessagesInput: { attribute: false },
    liveMessageVersion: { attribute: false },
    viewInAppMode: { attribute: false },
    viewInAppError: { attribute: false },
    focusMessageId: { attribute: false },
    focusRequestId: { attribute: false },
    _tab: { state: true },
    _fetchedMetadata: { state: true },
    _conversation: { state: true },
    _fetchedEvents: { state: true },
    _fetchedState: { state: true },
    _loadingMessages: { state: true },
    _loadingEvents: { state: true },
    _loadingState: { state: true },
    _messagesError: { state: true },
    _eventsError: { state: true },
    _stateError: { state: true },
    _expandedTools: { state: true },
    _expandedMessages: { state: true },
    _expandedTimelineDetails: { state: true },
    _expandedRawEvents: { state: true },
    _showDetailPanel: { state: true },
    _detailPanelWidth: { state: true },
    _eventsNotAvailable: { state: true },
    _stateNotAvailable: { state: true },
    _panelInitializing: { state: true },
    _activatedTabs: { state: true },
  };

  threadId: string | null = null;
  provider: ThreadDebuggerProvider | null = null;
  thread: ThreadDebuggerMetadata | ɵThread | null = null;
  runtimeUrl = "";
  headers: Record<string, string> = {};
  threadInspectionAvailable = false;
  agentStateInput: Record<string, unknown> | null = null;
  agentEventsInput: ApiAgentEvent[] = [];
  agentMessagesInput: ReadonlyArray<{
    id?: string;
    role: string;
    contentText: string;
  }> = EMPTY_INSPECTOR_MESSAGES;
  /**
   * Monotonic per-thread counter the parent inspector ticks every time the
   * agent currently running on this thread emits a message change. When this
   * prop changes for the same `threadId`, we re-fetch `/threads/:id/messages`
   * so the conversation view reflects live streaming output.
   */
  liveMessageVersion = 0;
  viewInAppMode: "hidden" | "view" | "stop" = "hidden";
  viewInAppError: string | null = null;
  focusMessageId: string | null = null;
  focusRequestId = 0;

  private _tab: ThreadDetailsTab = "timeline";
  private _fetchedMetadata: ThreadDebuggerMetadata | null = null;
  private _conversation: ConversationItem[] = [];
  private _fetchedEvents: ApiAgentEvent[] | null = null;
  private _fetchedState: Record<string, unknown> | null = null;
  private _loadingMessages = false;
  private _loadingEvents = false;
  private _loadingState = false;
  private _messagesError: string | null = null;
  private _eventsError: string | null = null;
  private _stateError: string | null = null;
  private _expandedTools = new Set<string>();
  private _expandedMessages = new Set<string>();
  private _expandedTimelineDetails = new Set<string>();
  private _expandedRawEvents = new Set<string>();
  private _showDetailPanel = false;
  private _detailPanelWidth = 250;
  /** True when the /events endpoint returned 501 — don't fall back to live data. */
  private _eventsNotAvailable = false;
  /** True when the /state endpoint returned 501 — don't fall back to live data. */
  private _stateNotAvailable = false;
  private _scrolledFocusRequestId = 0;
  private _highlightedFocusRequestId = -1;
  /**
   * Briefly true after a tab switch so the active-tab highlight + a generic
   * "Loading…" placeholder paint before the heavy per-tab render runs. Without
   * this, large event/conversation lists block the next paint and the user
   * sees the click as unresponsive for seconds.
   */
  private _panelInitializing = false;
  /**
   * Tabs that have been opened at least once for the current thread. Once a
   * tab is activated, its rendered DOM stays mounted (we hide inactive tabs
   * via display:none) so flipping back to it is just a CSS swap rather than
   * tearing down and rebuilding the entire panel from scratch. Without this,
   * switching back to AG-UI Events on a thread with hundreds of events
   * triggers a multi-second DOM-creation pass each time.
   *
   * Reset to {"timeline"} when the selected thread changes.
   */
  private _activatedTabs: Set<ThreadDetailsTab> = new Set(["timeline"]);
  /**
   * Memoized per-panel templates keyed by the inputs they render from.
   * When the underlying data hasn't changed (same `_conversation` /
   * `_fetchedState` / events array reference, plus expand-state for the
   * conversation panel), we return the previously built TemplateResult.
   * Lit then sees "same template, same values" and skips the diff entirely,
   * so re-rendering on tab switch is near-zero work even when the panel
   * content is large. The key is an opaque tuple compared element-wise by
   * reference; if any element flips, the cache misses and rebuilds.
   */
  private _panelTplCache: Map<
    ThreadDetailsPanelCacheSlot,
    { key: readonly unknown[]; tpl: TemplateResult }
  > = new Map();
  private _timelineItemsCache: {
    events: ApiAgentEvent[];
    conversation: ConversationItem[];
    agentMessages: CpkThreadInspector["agentMessagesInput"];
    items: TimelineItem[];
  } | null = null;
  private _liveEventsWithSourceIndexCache: {
    events: ApiAgentEvent[];
    indexedEvents: ApiAgentEvent[];
  } | null = null;
  /**
   * Tracks whether we've fetched events for the current thread yet. Events
   * fetch lazily on first sub-tab click so a large response's JSON.parse
   * doesn't block the main thread when the user only ever cares about the
   * conversation.
   */
  private _eventsFetched = false;
  /**
   * Tracks whether we've fetched state for the current thread yet. Same
   * lazy-load reasoning as `_eventsFetched`.
   */
  private _stateFetched = false;
  private _lastLoadKey: string | null = null;
  private _lastSeenLiveMessageVersion = 0;
  private _metadataAbort: AbortController | null = null;
  private _messagesAbort: AbortController | null = null;
  private _eventsAbort: AbortController | null = null;
  private _stateAbort: AbortController | null = null;
  private _hasConnectedOnce = false;
  private _dividerResizing = false;
  private _dividerPointerId = -1;
  private _dividerStartX = 0;
  private _dividerStartWidth = 0;
  private static nextDomId = 1;
  private readonly domIdPrefix = `cpk-thread-detail-${CpkThreadInspector.nextDomId++}`;

  static readonly COLLAPSE_THRESHOLD = 800;
  static readonly TAB_LIST: ReadonlyArray<{
    id: ThreadDetailsTab;
    label: string;
  }> = [
    { id: "timeline", label: "Messages" },
    { id: "raw-events", label: "AG-UI Events" },
    { id: "state", label: "State" },
  ];

  private renderTabContent(id: ThreadDetailsTab): TemplateResult {
    if (id === "timeline") return this.renderTimeline();
    if (id === "state") return this.renderState();
    return this.renderEvents();
  }

  /** Returns the stable DOM ID for one tab in this inspector instance. */
  private tabDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-tab-${id}`;
  }

  /** Returns the stable DOM ID for the panel controlled by one tab. */
  private panelDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-panel-${id}`;
  }

  /** Selects and focuses the tab targeted by an ARIA tabs navigation key. */
  private handleTabKeyDown(
    event: KeyboardEvent,
    currentId: ThreadDetailsTab,
  ): void {
    const currentIndex = CpkThreadInspector.TAB_LIST.findIndex(
      (tab) => tab.id === currentId,
    );
    if (currentIndex < 0) return;

    let targetIndex: number | null = null;
    if (event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % CpkThreadInspector.TAB_LIST.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex =
        (currentIndex - 1 + CpkThreadInspector.TAB_LIST.length) %
        CpkThreadInspector.TAB_LIST.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = CpkThreadInspector.TAB_LIST.length - 1;
    }
    if (targetIndex === null) return;

    const target = CpkThreadInspector.TAB_LIST[targetIndex];
    if (!target) return;
    event.preventDefault();
    this.activateTab(target.id);
    this.shadowRoot
      ?.querySelector<HTMLButtonElement>(`#${this.tabDomId(target.id)}`)
      ?.focus();
  }

  private activateTab(id: ThreadDetailsTab): void {
    if (this._tab === id) return;
    const isFirstActivation = !this._activatedTabs.has(id);
    this._tab = id;
    if (isFirstActivation) {
      // First time opening this tab: paint a "Loading…" overlay for one
      // frame so the tab highlight + spinner appear before the heavy
      // per-tab render runs (events list, state JSON). The rAF batches
      // mounting the panel into `_activatedTabs` and clearing the spinner
      // into a single subsequent paint. Subsequent activations are pure
      // CSS toggles via display:none on the already-mounted panel — no
      // re-render required.
      this._panelInitializing = true;
      requestAnimationFrame(() => {
        this._activatedTabs = new Set([...this._activatedTabs, id]);
        this._panelInitializing = false;
      });
    }
    this.maybeFetchTabData(id);
  }

  selectTab(id: ThreadDetailsTab): void {
    this.activateTab(id);
  }

  private maybeFetchTabData(id: ThreadDetailsTab): void {
    // Lazy-trigger the events / state fetches so their (potentially huge)
    // JSON.parse only blocks the main thread after the user has shown
    // intent to view that sub-tab. Without lazy-load, the eager fetch runs
    // as soon as the thread opens and a single large response can stall
    // the entire panel for seconds — including making the tab buttons
    // themselves feel unresponsive.
    if (!this.threadId) return;
    if ((id === "timeline" || id === "raw-events") && !this._eventsFetched) {
      this._eventsFetched = true;
      void this.fetchEvents(this.threadId);
    } else if (id === "state" && !this._stateFetched) {
      this._stateFetched = true;
      void this.fetchState(this.threadId);
    }
  }

  static styles = threadInspectorStyles;

  updated(_changed: Map<string, unknown>): void {
    if (!this.isConnected) return;
    const loadKey = this.currentLoadKey();
    if (loadKey !== this._lastLoadKey) {
      this._lastLoadKey = loadKey;
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this.resetLoadedThreadData();

      if (this.threadId) {
        // Timeline is the default tab and should be event-derived. Fetch
        // events eagerly; the raw tab reuses the same response when opened.
        // User messages often never appear as TEXT_MESSAGE events (they are
        // added locally before RUN_STARTED), so also load the conversation.
        void this.fetchMetadata(this.threadId);
        if (this.canFetchEvents()) {
          this._eventsFetched = true;
          void this.fetchEvents(this.threadId);
        }
        if (this.canFetchMessages()) {
          void this.fetchMessages(this.threadId);
        }
      } else {
        this._fetchedMetadata = null;
        this._conversation = [];
      }
    } else if (
      this.threadId &&
      this.liveMessageVersion !== this._lastSeenLiveMessageVersion
    ) {
      // Same thread, but the parent inspector signalled new agent-emitted
      // messages on this thread (via `liveMessageVersion`). Re-fetch the
      // canonical conversation from the runtime so streaming output flows
      // into the view without us reimplementing AG-UI → ConversationItem
      // mapping in the parent. `silent: true` so the loading-state indicator
      // doesn't flash between every streaming chunk and we keep the
      // last-good view on transient fetch errors.
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this._messagesAbort?.abort();
      this._messagesAbort = null;
      void this.fetchMessages(this.threadId, true);
    }

    const focusedContentChanged =
      _changed.has("_fetchedEvents") ||
      _changed.has("agentEventsInput") ||
      _changed.has("agentMessagesInput") ||
      _changed.has("_conversation");
    if (
      this.focusMessageId &&
      (this.focusRequestId > this._scrolledFocusRequestId ||
        focusedContentChanged)
    ) {
      if (this._tab !== "timeline") {
        this._activatedTabs = new Set([...this._activatedTabs, "timeline"]);
        this._tab = "timeline";
        this.requestUpdate();
      }
      requestAnimationFrame(() => this.scrollToFocusedMessage());
    }
  }

  private scrollToFocusedMessage(): void {
    if (!this.focusMessageId) return;
    const message = Array.from(
      this.shadowRoot?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((candidate) => candidate.dataset.messageId === this.focusMessageId);
    if (!message) return;
    message.scrollIntoView?.({ block: "center" });
    this._scrolledFocusRequestId = this.focusRequestId;
    this.pulseFocusedMessage(message);
  }

  private pulseFocusedMessage(message: HTMLElement): void {
    if (this.focusRequestId === this._highlightedFocusRequestId) return;
    this._highlightedFocusRequestId = this.focusRequestId;
    message.classList.remove("cpk-td__focus-pulse");
    void message.offsetWidth;
    message.classList.add("cpk-td__focus-pulse");
    message.addEventListener(
      "animationend",
      () => message.classList.remove("cpk-td__focus-pulse"),
      { once: true },
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    if (this._hasConnectedOnce) {
      this.requestUpdate();
    }
    this._hasConnectedOnce = true;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resetLoadedThreadData();
    this._lastLoadKey = null;
  }

  private canFetchMessages(): boolean {
    return canLoadThreadResource(
      this.provider,
      "messages",
      this.runtimeUrl,
      this.threadInspectionAvailable,
    );
  }

  private canFetchEvents(): boolean {
    return canLoadThreadResource(
      this.provider,
      "events",
      this.runtimeUrl,
      this.threadInspectionAvailable,
    );
  }

  private canFetchState(): boolean {
    return canLoadThreadResource(
      this.provider,
      "state",
      this.runtimeUrl,
      this.threadInspectionAvailable,
    );
  }

  private currentLoadKey(): string {
    return [
      this.threadId ?? "thread:none",
      createProviderLoadKey(this.provider),
      `runtime:${this.runtimeUrl}`,
      `headers:${createHeadersLoadKey(this.headers)}`,
      `inspect:${this.threadInspectionAvailable ? "1" : "0"}`,
    ].join("||");
  }

  private resetLoadedThreadData(): void {
    this._tab = "timeline";
    this._activatedTabs = new Set(["timeline"]);
    this._panelTplCache = new Map();
    this._timelineItemsCache = null;
    this._liveEventsWithSourceIndexCache = null;
    this._expandedTools = new Set();
    this._expandedMessages = new Set();
    this._expandedTimelineDetails = new Set();
    this._expandedRawEvents = new Set();
    this._metadataAbort?.abort();
    this._metadataAbort = null;
    this._messagesAbort?.abort();
    this._messagesAbort = null;
    this._eventsAbort?.abort();
    this._eventsAbort = null;
    this._stateAbort?.abort();
    this._stateAbort = null;
    // Reset cleared so the next click into events/state triggers a fresh
    // fetch. Eagerly clear fetched data so a provider/runtime swap cannot
    // briefly show the old source's values for the same threadId.
    this._eventsFetched = false;
    this._stateFetched = false;
    this._eventsNotAvailable = false;
    this._stateNotAvailable = false;
    this._loadingMessages = false;
    this._loadingEvents = false;
    this._loadingState = false;
    this._messagesError = null;
    this._eventsError = null;
    this._stateError = null;
    this._fetchedMetadata = null;
    this._conversation = [];
    this._fetchedEvents = null;
    this._fetchedState = null;
  }

  private async fetchMetadata(threadId: string): Promise<void> {
    if (!this.provider?.getThreadMetadata) return;
    this._metadataAbort?.abort();
    const controller = new AbortController();
    this._metadataAbort = controller;
    try {
      const metadata = await this.provider.getThreadMetadata(threadId, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.threadId !== threadId) return;
      this._fetchedMetadata = metadata;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._fetchedMetadata = null;
    }
  }

  /**
   * Fetch the canonical conversation for `threadId` from the runtime.
   *
   * `silent` is true for live re-fetches triggered by `liveMessageVersion`
   * bumps during streaming. In that mode we never toggle the loading state
   * (which would flash "Loading messages…" between every message) and we
   * keep the previous conversation on transient errors instead of blanking
   * it. Initial threadId-change fetches use the default (`silent=false`)
   * so users see an explicit loading indicator on first load.
   */
  private async fetchMessages(
    threadId: string,
    silent: boolean = false,
  ): Promise<void> {
    if (!this.canFetchMessages()) {
      if (!silent) this._conversation = [];
      return;
    }
    this._messagesAbort?.abort();
    const controller = new AbortController();
    this._messagesAbort = controller;
    if (!silent) {
      this._loadingMessages = true;
      this._messagesError = null;
    }
    try {
      const messages = this.provider?.getMessages
        ? await this.provider.getMessages(threadId, {
            signal: controller.signal,
          })
        : await this.fetchRuntimeMessages(threadId, controller.signal);
      if (controller.signal.aborted || this.threadId !== threadId) return;
      this._conversation = adaptThreadMessages(messages);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!silent) {
        this._messagesError =
          err instanceof Error ? err.message : "Failed to load messages";
        this._conversation = [];
      }
      // Silent mode: keep last-good conversation, don't surface the error.
      // The next successful live re-fetch will recover automatically.
    } finally {
      if (!silent && !controller.signal.aborted) {
        this._loadingMessages = false;
      }
    }
  }

  private async fetchEvents(threadId: string): Promise<void> {
    if (!this.canFetchEvents()) {
      this._fetchedEvents = null;
      return;
    }
    this._eventsAbort?.abort();
    const controller = new AbortController();
    this._eventsAbort = controller;
    this._loadingEvents = true;
    this._eventsError = null;
    try {
      const result = this.provider?.getEvents
        ? {
            status: "available" as const,
            events: await this.provider.getEvents(threadId, {
              signal: controller.signal,
            }),
          }
        : await this.fetchRuntimeEvents(threadId, controller.signal);
      // Drop results if a newer fetch superseded this one (thread switched
      // or provider/runtime changed mid-flight). Without this, switching A→B
      // can leave thread B's view showing thread A's events when A's request
      // resolves last.
      if (controller.signal.aborted || this.threadId !== threadId) return;
      if (result.status === "not-available") {
        this._eventsNotAvailable = true;
        this._fetchedEvents = [];
        return;
      }
      const mappedEvents = adaptThreadEvents(result.events);
      this._fetchedEvents = mappedEvents;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._eventsError =
        err instanceof Error ? err.message : "Failed to load events";
      this._fetchedEvents = [];
    } finally {
      if (!controller.signal.aborted && this.threadId === threadId) {
        this._loadingEvents = false;
      }
    }
  }

  private async fetchState(threadId: string): Promise<void> {
    if (!this.canFetchState()) {
      this._fetchedState = null;
      return;
    }
    this._stateAbort?.abort();
    const controller = new AbortController();
    this._stateAbort = controller;
    this._loadingState = true;
    this._stateError = null;
    try {
      const result = this.provider?.getState
        ? {
            status: "available" as const,
            state: await this.provider.getState(threadId, {
              signal: controller.signal,
            }),
          }
        : await this.fetchRuntimeState(threadId, controller.signal);
      if (controller.signal.aborted || this.threadId !== threadId) return;
      if (result.status === "not-available") {
        this._stateNotAvailable = true;
        this._fetchedState = null;
        return;
      }
      this._fetchedState = result.state ?? null;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._stateError =
        err instanceof Error ? err.message : "Failed to load state";
      this._fetchedState = null;
    } finally {
      if (!controller.signal.aborted && this.threadId === threadId) {
        this._loadingState = false;
      }
    }
  }

  private async fetchRuntimeMessages(
    threadId: string,
    signal: AbortSignal,
  ): Promise<ThreadDebuggerMessage[]> {
    const res = await fetch(
      getThreadInspectionUrl(this.runtimeUrl, threadId, "messages"),
      {
        headers: { ...this.headers },
        signal,
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { messages: ThreadDebuggerMessage[] };
    return data.messages;
  }

  private async fetchRuntimeEvents(
    threadId: string,
    signal: AbortSignal,
  ): Promise<RuntimeEventsFetchResult> {
    const res = await fetch(
      getThreadInspectionUrl(this.runtimeUrl, threadId, "events"),
      {
        headers: { ...this.headers },
        signal,
      },
    );
    if (res.status === 501) {
      return { status: "not-available" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      events: ThreadDebuggerEvent[];
    };
    return { status: "available", events: data.events };
  }

  private async fetchRuntimeState(
    threadId: string,
    signal: AbortSignal,
  ): Promise<RuntimeStateFetchResult> {
    const res = await fetch(
      getThreadInspectionUrl(this.runtimeUrl, threadId, "state"),
      {
        headers: { ...this.headers },
        signal,
      },
    );
    if (res.status === 501) {
      return { status: "not-available" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      state: Record<string, unknown> | null;
    };
    return { status: "available", state: data.state ?? null };
  }

  private get activeTimelineItems(): TimelineItem[] {
    return this.timelineItemsForEvents(this.activeEvents);
  }

  private timelineItemsForEvents(events: ApiAgentEvent[]): TimelineItem[] {
    const conversation = this._conversation;
    const agentMessages = this.agentMessagesInput;
    if (
      this._timelineItemsCache?.events === events &&
      this._timelineItemsCache.conversation === conversation &&
      this._timelineItemsCache.agentMessages === agentMessages
    ) {
      return this._timelineItemsCache.items;
    }
    const items = createTimelineItems(events, conversation, agentMessages);
    this._timelineItemsCache = { events, conversation, agentMessages, items };
    return items;
  }

  private get renderItems(): ConversationRenderItem[] {
    return groupConversationItems(this._conversation);
  }

  private get activityCounts(): {
    messages: number;
    toolCalls: number;
    generativeUi: number;
  } {
    let messages = 0;
    let toolCalls = 0;
    let generativeUi = 0;
    for (const item of this._conversation) {
      if (item.type === "user" || item.type === "assistant") messages++;
      if (item.type === "tool_call") toolCalls++;
      if (item.type === "generative-ui") generativeUi++;
    }
    return { messages, toolCalls, generativeUi };
  }

  private get duration(): string {
    const t = this.metadata;
    if (!t?.createdAt || !t?.updatedAt) return "—";
    const ms =
      new Date(t.updatedAt).getTime() - new Date(t.createdAt).getTime();
    if (ms < 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    return `${m}m ${rs}s`;
  }

  private toggleToolExpand(id: string): void {
    const next = new Set(this._expandedTools);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedTools = next;
  }

  private toggleMessageExpand(id: string): void {
    const next = new Set(this._expandedMessages);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedMessages = next;
  }

  private toggleTimelineDetails(id: string): void {
    const next = new Set(this._expandedTimelineDetails);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedTimelineDetails = next;
  }

  private expandTimelineDetails(ids: string[]): void {
    this._expandedTimelineDetails = new Set([
      ...this._expandedTimelineDetails,
      ...ids,
    ]);
  }

  private collapseTimelineDetails(ids: string[]): void {
    const next = new Set(this._expandedTimelineDetails);
    for (const id of ids) next.delete(id);
    this._expandedTimelineDetails = next;
  }

  private toggleRawEventDetails(id: string): void {
    const next = new Set(this._expandedRawEvents);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this._expandedRawEvents = next;
  }

  private expandRawEventDetails(ids: string[]): void {
    this._expandedRawEvents = new Set([...this._expandedRawEvents, ...ids]);
  }

  private collapseRawEventDetails(ids: string[]): void {
    const next = new Set(this._expandedRawEvents);
    for (const id of ids) next.delete(id);
    this._expandedRawEvents = next;
  }

  private get activeEvents(): ApiAgentEvent[] {
    // When the endpoint explicitly returned 501 we report no events rather
    // than leaking the parent's agent-keyed live events across historical
    // threads (those would render identically for every thread on the same
    // agent and mislead the reader).
    if (this._eventsNotAvailable) return [];
    const events = this._fetchedEvents ?? this.agentEventsInput ?? [];
    if (events.every((event) => event.sourceIndex != null)) return events;
    if (this._liveEventsWithSourceIndexCache?.events === events) {
      return this._liveEventsWithSourceIndexCache.indexedEvents;
    }
    const indexedEvents = events.map((event, index) =>
      event.sourceIndex == null ? { ...event, sourceIndex: index + 1 } : event,
    );
    this._liveEventsWithSourceIndexCache = { events, indexedEvents };
    return indexedEvents;
  }

  private get activeState(): Record<string, unknown> | null {
    if (this._stateNotAvailable) return null;
    return this._fetchedState ?? this.agentStateInput ?? null;
  }

  private shortId(id: string | null | undefined): string {
    if (!id) return "—";
    return id.length > 20 ? id.slice(0, 8) + "…" : id;
  }

  private get metadata(): ThreadDebuggerMetadata | null {
    return this._fetchedMetadata ?? this.thread ?? null;
  }

  private fmtTime(dateStr: string | null | undefined): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  private onDetailDividerDown = (event: PointerEvent): void => {
    this._dividerResizing = true;
    this._dividerPointerId = event.pointerId;
    this._dividerStartX = event.clientX;
    this._dividerStartWidth = this._detailPanelWidth;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private onDetailDividerMove = (event: PointerEvent): void => {
    if (!this._dividerResizing || this._dividerPointerId !== event.pointerId)
      return;
    const delta = this._dividerStartX - event.clientX;
    this._detailPanelWidth = Math.max(
      160,
      Math.min(400, this._dividerStartWidth + delta),
    );
  };

  private onDetailDividerUp = (event: PointerEvent): void => {
    if (this._dividerPointerId !== event.pointerId) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(this._dividerPointerId)) {
      target.releasePointerCapture(this._dividerPointerId);
    }
    this._dividerResizing = false;
  };

  render() {
    const viewInApp = this.renderViewInAppAction();
    return html`
      <div class="cpk-td">
        <!-- ── Left area: tabs + content ─────────────────────────────────── -->
        <div class="cpk-td__left">
          <!-- Tab bar -->
          <div class="cpk-td__tabs-header">
            <div
              class="cpk-td__tab-group"
              role="tablist"
              aria-label="Thread detail views"
            >
              ${CpkThreadInspector.TAB_LIST.map(
                (tab) => html`
                  <button
                    id=${this.tabDomId(tab.id)}
                    type="button"
                    role="tab"
                    aria-controls=${this.panelDomId(tab.id)}
                    aria-selected=${this._tab === tab.id ? "true" : "false"}
                    tabindex=${this._tab === tab.id ? "0" : "-1"}
                    class="cpk-td__tab ${
                      this._tab === tab.id ? "cpk-td__tab--active" : ""
                    }"
                    @click=${() => this.activateTab(tab.id)}
                    @keydown=${(event: KeyboardEvent) =>
                      this.handleTabKeyDown(event, tab.id)}
                  >
                    ${tab.label}
                  </button>
                `,
              )}
            </div>
            ${
              viewInApp !== nothing
                ? html`<div class="cpk-td__chrome-actions">${viewInApp}</div>`
                : nothing
            }
            ${this.renderPanelToggle()}
          </div>
          ${this.renderMetadataStrip()}

          <!-- Scrollable content -->
          <div class="cpk-td__content">
            ${
              this._panelInitializing
                ? html`
                    <div class="cpk-td__status">Loading…</div>
                  `
                : nothing
            }
            ${CpkThreadInspector.TAB_LIST.map((tab) =>
              this._activatedTabs.has(tab.id)
                ? html`<div
                    id=${this.panelDomId(tab.id)}
                    class="cpk-td__panel"
                    role="tabpanel"
                    aria-labelledby=${this.tabDomId(tab.id)}
                    ?hidden=${this._tab !== tab.id || this._panelInitializing}
                  >
                    ${this.renderTabContent(tab.id)}
                  </div>`
                : nothing,
            )}
          </div>
        </div>

        <!--
          Drawer always rendered so width animates between 0 and its
          target. Divider lives INSIDE the drawer and is absolutely
          positioned over its left edge so the toggle (rightmost of the
          tab row) and the drawer touch with no flex-gap between them.
        -->
        <div
          class="cpk-td__detail"
          data-open=${this._showDetailPanel ? "true" : "false"}
          style="width:${this._showDetailPanel ? this._detailPanelWidth : 0}px"
          aria-hidden=${this._showDetailPanel ? "false" : "true"}
        >
          ${
            this._showDetailPanel
              ? html`
                <div
                  class="cpk-td__detail-divider"
                  @pointerdown=${this.onDetailDividerDown}
                  @pointermove=${this.onDetailDividerMove}
                  @pointerup=${this.onDetailDividerUp}
                  @pointercancel=${this.onDetailDividerUp}
                ></div>
              `
              : nothing
          }
          ${this.renderDetailPanel()}
        </div>
      </div>
    `;
  }

  private renderMetadataStrip() {
    const metadata = this.metadata;
    const pills: Array<{ label: string; value: string; wrap?: boolean }> = [
      {
        label: "Name",
        value: metadata?.name ?? this.thread?.name ?? "Untitled",
      },
      { label: "ID", value: metadata?.id ?? this.threadId ?? "—" },
    ];
    for (const fact of [
      { label: "Agent", value: metadata?.agentId },
      { label: "Created", value: metadata?.createdAt },
      { label: "Updated", value: metadata?.updatedAt },
    ]) {
      if (fact.value == null || fact.value === "") continue;
      pills.push({
        label: fact.label,
        value:
          fact.label === "Created" || fact.label === "Updated"
            ? this.fmtTime(fact.value)
            : fact.value,
      });
    }
    return html`
      <div
        class="cpk-td__metadata-strip"
        role="group"
        aria-label="Thread metadata"
      >
        <div class="cpk-td__metadata-pills">
          ${pills.map(
            (pill) => html`
              <span
                class="cpk-td__metadata-pill ${
                  pill.wrap ? "cpk-td__metadata-pill--wrap" : ""
                }"
                role="group"
                title=${pill.value}
                aria-label=${`${pill.label}: ${pill.value}`}
              >
                <span class="cpk-td__metadata-label">${pill.label}</span>
                <span
                  class="cpk-td__metadata-value ${
                    pill.wrap ? "cpk-td__metadata-value--wrap" : ""
                  }"
                  >${pill.value}</span
                >
              </span>
            `,
          )}
        </div>
      </div>
    `;
  }

  private renderViewInAppAction() {
    if (this.viewInAppMode === "hidden") return nothing;
    const isStop = this.viewInAppMode === "stop";
    return html`
      <button
        type="button"
        class="cpk-td__view-in-app ${isStop ? "cpk-td__view-in-app--stop" : ""}"
        data-testid="cpk-inspector-view-in-app"
        aria-label=${
          isStop
            ? "Stop viewing this thread in the app"
            : "View this thread in your app"
        }
        @click=${() => {
          this.dispatchEvent(
            new CustomEvent(isStop ? "stopViewing" : "viewInApp", {
              bubbles: true,
              composed: true,
            }),
          );
        }}
      >
        ${isStop ? "Stop viewing" : "View in your app"}
      </button>
      ${
        this.viewInAppError
          ? html`<span class="cpk-td__view-in-app-error" role="alert"
              >${this.viewInAppError}</span
            >`
          : nothing
      }
    `;
  }

  private revealSourceEvent(sourceIndex: number): void {
    this._activatedTabs = new Set([...this._activatedTabs, "raw-events"]);
    this._tab = "raw-events";
    this.requestUpdate();
    requestAnimationFrame(() => {
      const source = this.shadowRoot?.querySelector<HTMLElement>(
        `[data-source-index="${sourceIndex}"]`,
      );
      source?.scrollIntoView?.({ block: "center" });
    });
  }

  private renderTimeline() {
    if (this._loadingEvents) {
      return html`
        <div class="cpk-td__status">Loading timeline…</div>
      `;
    }
    if (this._eventsError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._eventsError}
      </div>`;
    }
    if (this._eventsNotAvailable) {
      if (this._conversation.length > 0 || this._loadingMessages) {
        return this.renderConversation();
      }
      return html`
        <div class="cpk-td__empty-state">
          <span>Timeline event history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread AG-UI events. Check State for
            the latest snapshot when available.</span
          >
        </div>
      `;
    }

    const events = this.activeEvents;
    const cacheKey = [
      events,
      this._conversation,
      this.agentMessagesInput,
      this._expandedTimelineDetails,
    ];
    const cachedTimeline = this.getCachedPanelTpl("timeline", cacheKey);
    if (cachedTimeline) return cachedTimeline;

    const items = this.timelineItemsForEvents(events);
    if (items.length === 0) {
      if (this._conversation.length > 0 || this._loadingMessages) {
        return this.renderConversation();
      }
      return html`
        <div class="cpk-td__empty-state">
          <span>No timeline events captured</span>
          <span class="cpk-td__empty-hint"
            >Timeline rows are normalized from AG-UI events. Open AG-UI Events or State
            to inspect the available thread data.</span
          >
        </div>
      `;
    }

    return this.cachedPanelTpl("timeline", cacheKey, () =>
      renderTimelineItems({
        items,
        expandedDetails: this._expandedTimelineDetails,
        onExpandAll: (ids) => this.expandTimelineDetails(ids),
        onCollapseAll: (ids) => this.collapseTimelineDetails(ids),
        onToggleDetails: (id) => this.toggleTimelineDetails(id),
        onRevealSourceEvent: (sourceIndex) =>
          this.revealSourceEvent(sourceIndex),
      }),
    );
  }

  private renderConversation() {
    if (this._loadingMessages) {
      return html`
        <div class="cpk-td__status">Loading messages…</div>
      `;
    }
    if (this._messagesError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._messagesError}
      </div>`;
    }
    if (this._conversation.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span>No messages yet</span>
        </div>
      `;
    }
    return this.cachedPanelTpl(
      "timeline-fallback",
      [this._conversation, this._expandedTools, this._expandedMessages],
      () =>
        renderConversationItems(this.renderItems, {
          collapseThreshold: CpkThreadInspector.COLLAPSE_THRESHOLD,
          expandedMessages: this._expandedMessages,
          expandedTools: this._expandedTools,
          onToggleMessage: (id) => this.toggleMessageExpand(id),
          onToggleTool: (id) => this.toggleToolExpand(id),
        }),
    );
  }

  /**
   * Memoize the rendered TemplateResult for `slot` keyed by tuple
   * element-wise reference equality. The hot path for tab switches: when
   * the underlying data hasn't changed, return the previously built
   * TemplateResult so Lit's diff short-circuits. Each panel's `key` is
   * the tuple of inputs the template reads — pass everything the template
   * depends on, or the cache will return stale output when those inputs
   * change without the listed key flipping.
   */
  private cachedPanelTpl(
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
    build: () => TemplateResult,
  ): TemplateResult {
    const cached = this.getCachedPanelTpl(slot, key);
    if (cached) return cached;
    const tpl = build();
    this._panelTplCache.set(slot, { key, tpl });
    return tpl;
  }

  private getCachedPanelTpl(
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
  ): TemplateResult | null {
    const cached = this._panelTplCache.get(slot);
    if (
      cached &&
      cached.key.length === key.length &&
      cached.key.every((v, i) => v === key[i])
    ) {
      return cached.tpl;
    }
    return null;
  }

  private renderState() {
    const state = this.activeState;
    const options = {
      loading: this._loadingState,
      error: this._stateError,
      notAvailable: this._stateNotAvailable,
      state,
    };
    if (
      !options.loading &&
      !options.error &&
      !options.notAvailable &&
      state &&
      Object.keys(state).length > 0
    ) {
      return this.cachedPanelTpl("state", [state], () =>
        renderThreadStateView(options),
      );
    }
    return renderThreadStateView(options);
  }

  private renderEvents() {
    if (this._loadingEvents) {
      return html`
        <div class="cpk-td__status">Loading events…</div>
      `;
    }
    if (this._eventsError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._eventsError}
      </div>`;
    }
    if (this._eventsNotAvailable) {
      return html`
        <div class="cpk-td__empty-state">
          <span>Event history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread AG-UI events. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    const events = this.activeEvents;
    if (events.length === 0) {
      return html`
        <div class="cpk-td__empty-state">
          <span>No events captured</span>
          <span class="cpk-td__empty-hint"
            >Events are recorded live. Run the agent to see them here.</span
          >
        </div>
      `;
    }
    return this.cachedPanelTpl(
      "raw-events",
      [events, this._expandedRawEvents],
      () =>
        renderThreadEventsView({
          events,
          expandedEvents: this._expandedRawEvents,
          onExpandAll: (ids) => this.expandRawEventDetails(ids),
          onCollapseAll: (ids) => this.collapseRawEventDetails(ids),
          onToggleDetails: (id) => this.toggleRawEventDetails(id),
        }),
    );
  }

  private renderPanelToggle() {
    return html`
      <button
        class="cpk-td__panel-toggle ${
          this._showDetailPanel ? "cpk-td__panel-toggle--active" : ""
        }"
        @click=${() => {
          this._showDetailPanel = !this._showDetailPanel;
        }}
        title="Toggle thread details"
        type="button"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
    `;
  }

  private renderDetailPanel() {
    const counts = this.activityCounts;
    const metadata = this.metadata;
    return html`
      <!-- Thread -->
      <div class="cpk-tdp__section-title">Thread</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">ID</span>
        <span class="cpk-tdp__value cpk-tdp__value--wrap"
          >${metadata?.id ?? this.threadId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Name</span>
        <span class="cpk-tdp__value">${metadata?.name ?? "—"}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Agent</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.agentId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">End user</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.endUserId ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created by</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.createdById ?? "—"}</span
        >
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Status</span>
        <span class="cpk-tdp__value cpk-tdp__value--truncate"
          >${metadata?.status ?? "—"}</span
        >
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Timestamps -->
      <div class="cpk-tdp__section-title">Timestamps</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Created</span>
        <span class="cpk-tdp__value">${this.fmtTime(metadata?.createdAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Updated</span>
        <span class="cpk-tdp__value">${this.fmtTime(metadata?.updatedAt)}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Duration</span>
        <span class="cpk-tdp__value">${this.duration}</span>
      </div>

      <div class="cpk-tdp__divider"></div>

      <!-- Activity -->
      <div class="cpk-tdp__section-title">Activity</div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Messages</span>
        <span class="cpk-tdp__value">${counts.messages}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">Tool calls</span>
        <span class="cpk-tdp__value">${counts.toolCalls}</span>
      </div>
      <div class="cpk-tdp__row">
        <span class="cpk-tdp__label">AG-UI events</span>
        <span class="cpk-tdp__value">${this.activeEvents.length}</span>
      </div>
    `;
  }
}

export class ɵCpkThreadDetails extends CpkThreadInspector {}
