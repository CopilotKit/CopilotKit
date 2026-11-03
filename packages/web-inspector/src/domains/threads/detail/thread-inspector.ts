import type { ɵThread } from "@copilotkit/core";
import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type {
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
} from "../../../shared/thread-debugger/types.js";
import { PortableLitElement } from "../../../ui/portable-lit-element.js";
import { adaptThreadEvents } from "./event-adapter.js";
import type { ApiAgentEvent } from "./event-adapter.js";
import {
  adaptThreadMessages,
  groupConversationItems,
} from "./message-adapter.js";
import type { ConversationItem } from "./message-adapter.js";
import {
  canLoadThreadResource,
  createThreadLoadKey,
  isCurrentThreadLoad,
} from "./provider.js";
import type { ThreadDebuggerResource } from "./provider.js";
import {
  addEventSourceIndexes,
  addSetValues,
  countThreadActivity,
  EMPTY_INSPECTOR_MESSAGES,
  THREAD_INSPECTOR_PROPERTIES,
  formatThreadDuration,
  formatThreadTime,
  removeSetValues,
  toggleSetValue,
} from "./thread-inspector-model.js";
import type { ThreadDetailsTab } from "./thread-inspector-model.js";
import {
  THREAD_DETAILS_TABS,
  createPanelTemplateCache,
  renderConversationPanel,
  renderDetailPanel,
  renderEventsPanel,
  renderPanelToggle,
  renderStatePanel,
  renderThreadInspectorView,
  renderThreadHeader,
  renderTimelinePanel,
  renderTryFromHereAction,
  renderViewInAppAction,
} from "./thread-inspector-view.js";
import type { PanelTemplateCacheEntries } from "./thread-inspector-view.js";
import {
  loadThreadEvents,
  loadThreadMessages,
  loadThreadState,
} from "./thread-runtime.js";
import type {
  InspectorHeadersResolver,
  ThreadResourceRequest,
} from "./thread-runtime.js";
import { MessageRefreshScheduler } from "./message-refresh.js";
import { findFocusedMessage, pulseMessage } from "./focus.js";
import { DividerResize } from "./divider-resize.js";
import {
  conversationRunErrors,
  streamingToolCallIds,
  createTimelineItems,
} from "./timeline-model.js";
import type { TimelineItem } from "./timeline-model.js";
import { renderTimelineBulkToggle } from "./timeline-view.js";
import { threadInspectorStyles } from "./thread-inspector.styles.js";

export type { ThreadDetailsTab } from "./thread-inspector-model.js";

// Sentinel identity: tells whether a host actually set `resolveHeaders`.
const DEFAULT_RESOLVE_HEADERS: InspectorHeadersResolver = () => ({});

export class CpkThreadInspector extends PortableLitElement {
  static properties = THREAD_INSPECTOR_PROPERTIES;

  /** Whether to render the viewer title. Set false when the embedding page owns its heading. */
  showThreadTitle = true;
  threadId: string | null = null;
  provider: ThreadDebuggerProvider | null = null;
  thread: ThreadDebuggerMetadata | ɵThread | null = null;
  runtimeUrl = "";
  /**
   * @deprecated Set `resolveHeaders`, which resolves fresh headers at send
   * time (#1937). Used only while `resolveHeaders` keeps its default.
   */
  headers: Record<string, string> = {};
  resolveHeaders: InspectorHeadersResolver = DEFAULT_RESOLVE_HEADERS;
  /** Bumped only by a header-source change; never by a new header value. */
  headersGeneration = 0;
  threadInspectionAvailable = false;
  agentStateInput: Record<string, unknown> | null = null;
  agentEventsInput: ApiAgentEvent[] = [];
  agentMessagesInput: ReadonlyArray<{
    id?: string;
    role: string;
    contentText: string;
  }> = EMPTY_INSPECTOR_MESSAGES;
  liveMessageVersion = 0;
  viewInAppMode: "hidden" | "view" | "stop" = "hidden";
  viewInAppError: string | null = null;
  tryFromHereAvailable = false;
  tryFromHereBusy = false;
  tryFromHereError: string | null = null;
  focusMessageId: string | null = null;
  focusRequestId = 0;
  private _tab: ThreadDetailsTab = "timeline";
  private _showEventTimeline = false;
  private _fetchedMetadata: ThreadDebuggerMetadata | null = null;
  private _conversation: ConversationItem[] = [];
  private _fetchedEvents: ApiAgentEvent[] | null = null;
  private _fetchedState: Record<string, unknown> | null = null;
  private _loadingMessages = false;
  private _loadingEvents = false;
  private _loadingState = false;
  private _messagesError: string | null = null;
  private _messageRefreshError: string | null = null;
  private _eventsError: string | null = null;
  private _stateError: string | null = null;
  private _expandedTools = new Set<string>();
  private _expandedMessages = new Set<string>();
  private _expandedTimelineDetails = new Set<string>();
  private _expandedRawEvents = new Set<string>();
  private _showDetailPanel = false;
  private _detailPanelWidth = 250;
  private _eventsNotAvailable = false;
  private _stateNotAvailable = false;
  private _scrolledFocusRequestId = 0;
  private _highlightedFocusRequestId = -1;
  private _panelInitializing = false;
  private _activatedTabs: Set<ThreadDetailsTab> = new Set(["timeline"]);
  private _panelTplCache: PanelTemplateCacheEntries = new Map();
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
  private _eventsFetched = false;
  private _stateFetched = false;
  private _lastLoadKey: string | null = null;
  private _lastSeenLiveMessageVersion = 0;
  private _metadataAbort: AbortController | null = null;
  private _messagesAbort: AbortController | null = null;
  private readonly _messageRefresh = new MessageRefreshScheduler(1_000);
  private _eventsAbort: AbortController | null = null;
  private _stateAbort: AbortController | null = null;
  private _hasConnectedOnce = false;
  private readonly _divider = new DividerResize(
    () => this._detailPanelWidth,
    (width) => {
      this._detailPanelWidth = width;
    },
  );
  private static nextDomId = 1;
  private readonly domIdPrefix = `cpk-thread-detail-${CpkThreadInspector.nextDomId++}`;

  static readonly COLLAPSE_THRESHOLD = 800;

  private renderTabContent(id: ThreadDetailsTab): TemplateResult {
    if (id === "timeline") {
      return html`${
        this._messageRefreshError
          ? html`<div class="cpk-td__status cpk-td__status--error" role="status">${this._messageRefreshError}</div>`
          : nothing
      }${
        this._showEventTimeline
          ? html`<div class="cpk-td__timeline-toolbar">${this.renderTimelineBulkToggle()}</div>${this.renderTimeline()}`
          : this._conversation.length ||
              this._loadingMessages ||
              this._messagesError
            ? this.renderConversation()
            : this.renderTimeline()
      }`;
    }
    if (id === "state") return this.renderState();
    return this.renderEvents();
  }

  private renderTimelineBulkToggle() {
    if (this._eventsNotAvailable) return nothing;
    return renderTimelineBulkToggle({
      items: this.timelineItemsForEvents(this.activeEvents),
      expandedDetails: this._expandedTimelineDetails,
      onExpandAll: (ids) => this.expandTimelineDetails(ids),
      onCollapseAll: (ids) => this.collapseTimelineDetails(ids),
    });
  }

  private tabDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-tab-${id}`;
  }

  private panelDomId(id: ThreadDetailsTab): string {
    return `${this.domIdPrefix}-panel-${id}`;
  }

  private handleTabKeyDown(
    event: KeyboardEvent,
    currentId: ThreadDetailsTab,
  ): void {
    const currentIndex = THREAD_DETAILS_TABS.findIndex(
      (tab) => tab.id === currentId,
    );
    if (currentIndex < 0) return;

    let targetIndex: number | null = null;
    if (event.key === "ArrowRight") {
      targetIndex = (currentIndex + 1) % THREAD_DETAILS_TABS.length;
    } else if (event.key === "ArrowLeft") {
      targetIndex =
        (currentIndex - 1 + THREAD_DETAILS_TABS.length) %
        THREAD_DETAILS_TABS.length;
    } else if (event.key === "Home") {
      targetIndex = 0;
    } else if (event.key === "End") {
      targetIndex = THREAD_DETAILS_TABS.length - 1;
    }
    if (targetIndex === null) return;

    const target = THREAD_DETAILS_TABS[targetIndex];
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
    const loadKey = createThreadLoadKey(this);
    if (loadKey !== this._lastLoadKey) {
      this._lastLoadKey = loadKey;
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this.resetLoadedThreadData();

      if (this.threadId) {
        void this.fetchMetadata(this.threadId);
        if (this.canFetch("events")) {
          this._eventsFetched = true;
          void this.fetchEvents(this.threadId);
        }
        if (this.canFetch("messages")) {
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
      this._lastSeenLiveMessageVersion = this.liveMessageVersion;
      this._messageRefresh.request();
      this.scheduleMessagesRefresh();
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
    const message = findFocusedMessage(
      this.shadowRoot,
      this.panelDomId(this._tab),
      this.focusMessageId,
    );
    if (!message) return;
    message.scrollIntoView?.({ block: "center" });
    this._scrolledFocusRequestId = this.focusRequestId;
    if (this.focusRequestId === this._highlightedFocusRequestId) return;
    this._highlightedFocusRequestId = this.focusRequestId;
    pulseMessage(message);
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

  private canFetch(resource: ThreadDebuggerResource): boolean {
    return canLoadThreadResource(
      this.provider,
      resource,
      this.runtimeUrl,
      this.threadInspectionAvailable,
    );
  }

  private isCurrentLoad(
    controller: AbortController,
    activeController: AbortController | null,
    loadKey: string,
  ): boolean {
    return isCurrentThreadLoad(
      controller,
      activeController,
      loadKey,
      createThreadLoadKey(this),
    );
  }

  private resetLoadedThreadData(): void {
    this._messageRefresh.reset();
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
    this._eventsFetched = false;
    this._stateFetched = false;
    this._eventsNotAvailable = false;
    this._stateNotAvailable = false;
    this._loadingMessages = false;
    this._loadingEvents = false;
    this._loadingState = false;
    this._messagesError = null;
    this._messageRefreshError = null;
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
    const loadKey = createThreadLoadKey(this);
    this._metadataAbort = controller;
    try {
      const metadata = await this.provider.getThreadMetadata(threadId, {
        signal: controller.signal,
      });
      if (!this.isCurrentLoad(controller, this._metadataAbort, loadKey)) return;
      this._fetchedMetadata = metadata;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!this.isCurrentLoad(controller, this._metadataAbort, loadKey)) return;
      this._fetchedMetadata = null;
    }
  }

  private async fetchMessages(
    threadId: string,
    silent: boolean = false,
  ): Promise<void> {
    if (!this.canFetch("messages")) {
      if (!silent) this._conversation = [];
      return;
    }
    this._messageRefresh.started();
    this._messagesAbort?.abort();
    const controller = new AbortController();
    const loadKey = createThreadLoadKey(this);
    this._messagesAbort = controller;
    if (!silent) {
      this._loadingMessages = true;
      this._messagesError = null;
      this._messageRefreshError = null;
    }
    try {
      const messages = await loadThreadMessages(
        this.provider,
        this.runtimeRequest(threadId, controller),
      );
      if (!this.isCurrentLoad(controller, this._messagesAbort, loadKey)) return;
      this._conversation = adaptThreadMessages(messages);
      this._messagesError = null;
      this._messageRefreshError = null;
    } catch (err) {
      if (!this.isCurrentLoad(controller, this._messagesAbort, loadKey)) return;
      if (err instanceof Error && err.name === "AbortError") return;
      if (!silent || this._conversation.length === 0) {
        this._messagesError =
          err instanceof Error ? err.message : "Failed to load messages";
        this._conversation = [];
      } else {
        this._messageRefreshError =
          "Could not refresh messages. Showing the last loaded conversation.";
      }
    } finally {
      // A stale provider may ignore abort and settle after a new source loads.
      if (this._messagesAbort === controller) {
        this._messagesAbort = null;
        if (
          !controller.signal.aborted &&
          createThreadLoadKey(this) === loadKey
        ) {
          this._loadingMessages = false;
          this.scheduleMessagesRefresh();
        }
      }
    }
  }

  /** Starts a queued live refresh once no request is in flight. */
  private scheduleMessagesRefresh(): void {
    const threadId = this.threadId;
    const loadKey = this._lastLoadKey;
    const canRun = () =>
      this.isConnected &&
      !this._messagesAbort &&
      !!threadId &&
      this.canFetch("messages") &&
      this._lastLoadKey === loadKey &&
      createThreadLoadKey(this) === loadKey;
    this._messageRefresh.schedule(canRun, () => {
      if (threadId) void this.fetchMessages(threadId, true);
    });
  }

  private runtimeRequest(
    threadId: string,
    controller: AbortController,
  ): ThreadResourceRequest {
    return {
      runtimeUrl: this.runtimeUrl,
      threadId,
      signal: controller.signal,
      // `resolveHeaders` when a host set it; else the deprecated `headers`.
      resolveHeaders: () =>
        this.resolveHeaders === DEFAULT_RESOLVE_HEADERS
          ? this.headers
          : this.resolveHeaders(),
    };
  }

  private async fetchEvents(threadId: string): Promise<void> {
    if (!this.canFetch("events")) {
      this._fetchedEvents = null;
      return;
    }
    this._eventsAbort?.abort();
    const controller = new AbortController();
    const loadKey = createThreadLoadKey(this);
    this._eventsAbort = controller;
    this._loadingEvents = true;
    this._eventsError = null;
    try {
      const result = await loadThreadEvents(
        this.provider,
        this.runtimeRequest(threadId, controller),
      );
      if (!this.isCurrentLoad(controller, this._eventsAbort, loadKey)) return;
      if (result.status === "not-available") {
        this._eventsNotAvailable = true;
        this._fetchedEvents = [];
        return;
      }
      const mappedEvents = adaptThreadEvents(result.events);
      this._fetchedEvents = mappedEvents;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!this.isCurrentLoad(controller, this._eventsAbort, loadKey)) return;
      this._eventsError =
        err instanceof Error ? err.message : "Failed to load events";
      this._fetchedEvents = [];
    } finally {
      if (this.isCurrentLoad(controller, this._eventsAbort, loadKey)) {
        this._loadingEvents = false;
      }
    }
  }

  private async fetchState(threadId: string): Promise<void> {
    if (!this.canFetch("state")) {
      this._fetchedState = null;
      return;
    }
    this._stateAbort?.abort();
    const controller = new AbortController();
    const loadKey = createThreadLoadKey(this);
    this._stateAbort = controller;
    this._loadingState = true;
    this._stateError = null;
    try {
      const result = await loadThreadState(
        this.provider,
        this.runtimeRequest(threadId, controller),
      );
      if (!this.isCurrentLoad(controller, this._stateAbort, loadKey)) return;
      if (result.status === "not-available") {
        this._stateNotAvailable = true;
        this._fetchedState = null;
        return;
      }
      this._fetchedState = result.state ?? null;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!this.isCurrentLoad(controller, this._stateAbort, loadKey)) return;
      this._stateError =
        err instanceof Error ? err.message : "Failed to load state";
      this._fetchedState = null;
    } finally {
      if (this.isCurrentLoad(controller, this._stateAbort, loadKey)) {
        this._loadingState = false;
      }
    }
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

  private toggleToolExpand(id: string): void {
    this._expandedTools = toggleSetValue(this._expandedTools, id);
  }

  private toggleMessageExpand(id: string): void {
    this._expandedMessages = toggleSetValue(this._expandedMessages, id);
  }

  private toggleTimelineDetails(id: string): void {
    this._expandedTimelineDetails = toggleSetValue(
      this._expandedTimelineDetails,
      id,
    );
  }

  private expandTimelineDetails(ids: string[]): void {
    this._expandedTimelineDetails = addSetValues(
      this._expandedTimelineDetails,
      ids,
    );
  }

  private collapseTimelineDetails(ids: string[]): void {
    this._expandedTimelineDetails = removeSetValues(
      this._expandedTimelineDetails,
      ids,
    );
  }

  private toggleRawEventDetails(id: string): void {
    this._expandedRawEvents = toggleSetValue(this._expandedRawEvents, id);
  }

  private expandRawEventDetails(ids: string[]): void {
    this._expandedRawEvents = addSetValues(this._expandedRawEvents, ids);
  }

  private collapseRawEventDetails(ids: string[]): void {
    this._expandedRawEvents = removeSetValues(this._expandedRawEvents, ids);
  }

  private get activeEvents(): ApiAgentEvent[] {
    if (this._eventsNotAvailable) return [];
    const events = this._fetchedEvents ?? this.agentEventsInput ?? [];
    if (events.every((event) => event.sourceIndex != null)) return events;
    if (this._liveEventsWithSourceIndexCache?.events === events) {
      return this._liveEventsWithSourceIndexCache.indexedEvents;
    }
    const indexedEvents = addEventSourceIndexes(events);
    this._liveEventsWithSourceIndexCache = { events, indexedEvents };
    return indexedEvents;
  }

  private get activeState(): Record<string, unknown> | null {
    if (this._stateNotAvailable) return null;
    return this._fetchedState ?? this.agentStateInput ?? null;
  }

  private get metadata(): ThreadDebuggerMetadata | null {
    return this._fetchedMetadata ?? this.thread ?? null;
  }

  render() {
    return renderThreadInspectorView({
      activeTab: this._tab,
      activatedTabs: this._activatedTabs,
      panelInitializing: this._panelInitializing,
      showDetailPanel: this._showDetailPanel,
      detailPanelWidth: this._detailPanelWidth,
      tabDomId: (id) => this.tabDomId(id),
      panelDomId: (id) => this.panelDomId(id),
      onActivateTab: (id) => this.activateTab(id),
      onTabKeyDown: (event, id) => this.handleTabKeyDown(event, id),
      onDetailDividerDown: this._divider.down,
      onDetailDividerMove: this._divider.move,
      onDetailDividerUp: this._divider.up,
      threadHeader: renderThreadHeader({
        title: this.showThreadTitle
          ? this.metadata?.name || this.thread?.name || "Rich Thread"
          : null,
        showActions: this._tab === "timeline",
        showEventTimeline: this._showEventTimeline,
        onToggleEventTimeline: () => {
          this._showEventTimeline = !this._showEventTimeline;
        },
        tryFromHere: renderTryFromHereAction(this),
      }),
      viewInAppAction: renderViewInAppAction(this),
      panelToggle: this.renderPanelToggle(),
      detailPanel: this.renderDetailPanel(),
      conversationPanel:
        !this._showEventTimeline && this._conversation.length > 0,
      renderTabContent: (id) => this.renderTabContent(id),
    });
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

  private renderTimeline(): TemplateResult {
    return renderTimelinePanel({
      loadingEvents: this._loadingEvents,
      eventsError: this._eventsError,
      eventsNotAvailable: this._eventsNotAvailable,
      conversation: this._conversation,
      loadingMessages: this._loadingMessages,
      agentMessages: this.agentMessagesInput,
      expandedDetails: this._expandedTimelineDetails,
      getEvents: () => this.activeEvents,
      getTimelineItems: (events) => this.timelineItemsForEvents(events),
      renderConversation: () => this.renderConversation(),
      cache: this.panelTemplateCache,
      onToggleDetails: (id) => this.toggleTimelineDetails(id),
      onRevealSourceEvent: (sourceIndex) => this.revealSourceEvent(sourceIndex),
    });
  }

  private renderConversation(): TemplateResult {
    return renderConversationPanel({
      loading: this._loadingMessages,
      error: this._messagesError,
      conversation: this._conversation,
      renderItems: () => groupConversationItems(this._conversation),
      runErrors: (items) => conversationRunErrors(items, this.activeEvents),
      streamingTools: () =>
        streamingToolCallIds(this.agentEventsInput, this.threadId),
      expandedTools: this._expandedTools,
      expandedMessages: this._expandedMessages,
      expandedDetails: this._expandedTimelineDetails,
      collapseThreshold: CpkThreadInspector.COLLAPSE_THRESHOLD,
      cache: this.panelTemplateCache,
      onToggleMessage: (id) => this.toggleMessageExpand(id),
      onToggleTool: (id) => this.toggleToolExpand(id),
      onToggleDetails: (id) => this.toggleTimelineDetails(id),
      onRevealSourceEvent: (sourceIndex) => this.revealSourceEvent(sourceIndex),
    });
  }

  private get panelTemplateCache() {
    return createPanelTemplateCache(this._panelTplCache);
  }

  private renderState(): TemplateResult {
    return renderStatePanel({
      loading: this._loadingState,
      error: this._stateError,
      notAvailable: this._stateNotAvailable,
      state: this.activeState,
      cache: this.panelTemplateCache,
    });
  }

  private renderEvents(): TemplateResult {
    return renderEventsPanel({
      loading: this._loadingEvents,
      error: this._eventsError,
      notAvailable: this._eventsNotAvailable,
      getEvents: () => this.activeEvents,
      expandedEvents: this._expandedRawEvents,
      cache: this.panelTemplateCache,
      onExpandAll: (ids) => this.expandRawEventDetails(ids),
      onCollapseAll: (ids) => this.collapseRawEventDetails(ids),
      onToggleDetails: (id) => this.toggleRawEventDetails(id),
    });
  }

  private renderPanelToggle(): TemplateResult {
    return renderPanelToggle({
      isOpen: this._showDetailPanel,
      onToggle: () => {
        this._showDetailPanel = !this._showDetailPanel;
      },
    });
  }

  private renderDetailPanel(): TemplateResult {
    return renderDetailPanel({
      metadata: this.metadata,
      threadId: this.threadId,
      duration: formatThreadDuration(this.metadata),
      counts: countThreadActivity(this._conversation),
      eventCount: this.activeEvents.length,
      formatTime: formatThreadTime,
    });
  }
}

export class ɵCpkThreadDetails extends CpkThreadInspector {}
