import type { ɵThread } from "@copilotkit/core";
import { html } from "lit";
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
  createThreadMetadataPills,
  EMPTY_INSPECTOR_MESSAGES,
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
  renderMetadataStrip,
  renderPanelToggle,
  renderStatePanel,
  renderThreadInspectorView,
  renderTimelinePanel,
  renderTryFromHereAction,
  renderViewInAppAction,
} from "./thread-inspector-view.js";
import type { PanelTemplateCacheEntries } from "./thread-inspector-view.js";
import {
  fetchRuntimeEvents,
  fetchRuntimeMessages,
  fetchRuntimeState,
} from "./thread-runtime.js";
import { createTimelineItems } from "./timeline-model.js";
import type { TimelineItem } from "./timeline-model.js";
import { renderTimelineToolbar } from "./timeline-view.js";
import { threadInspectorStyles } from "./thread-inspector.styles.js";

export type { ThreadDetailsTab } from "./thread-inspector-model.js";

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
    tryFromHereAvailable: { attribute: false },
    tryFromHereBusy: { attribute: false },
    tryFromHereError: { attribute: false },
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
  liveMessageVersion = 0;
  viewInAppMode: "hidden" | "view" | "stop" = "hidden";
  viewInAppError: string | null = null;
  tryFromHereAvailable = false;
  tryFromHereBusy = false;
  tryFromHereError: string | null = null;
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

  private renderTabContent(id: ThreadDetailsTab): TemplateResult {
    if (id === "timeline") {
      const items = this._eventsNotAvailable
        ? []
        : this.timelineItemsForEvents(this.activeEvents);
      return html`${renderTimelineToolbar({
        items,
        expandedDetails: this._expandedTimelineDetails,
        action: renderTryFromHereAction(this),
        onExpandAll: (ids) => this.expandTimelineDetails(ids),
        onCollapseAll: (ids) => this.collapseTimelineDetails(ids),
      })}${this.renderTimeline()}`;
    }
    if (id === "state") return this.renderState();
    return this.renderEvents();
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
    this._messagesAbort?.abort();
    const controller = new AbortController();
    const loadKey = createThreadLoadKey(this);
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
        : await fetchRuntimeMessages({
            runtimeUrl: this.runtimeUrl,
            threadId,
            headers: this.headers,
            signal: controller.signal,
          });
      if (!this.isCurrentLoad(controller, this._messagesAbort, loadKey)) return;
      this._conversation = adaptThreadMessages(messages);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (!this.isCurrentLoad(controller, this._messagesAbort, loadKey)) return;
      if (!silent) {
        this._messagesError =
          err instanceof Error ? err.message : "Failed to load messages";
        this._conversation = [];
      }
    } finally {
      if (
        !silent &&
        this.isCurrentLoad(controller, this._messagesAbort, loadKey)
      ) {
        this._loadingMessages = false;
      }
    }
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
      const result = this.provider?.getEvents
        ? {
            status: "available" as const,
            events: await this.provider.getEvents(threadId, {
              signal: controller.signal,
            }),
          }
        : await fetchRuntimeEvents({
            runtimeUrl: this.runtimeUrl,
            threadId,
            headers: this.headers,
            signal: controller.signal,
          });
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
      const result = this.provider?.getState
        ? {
            status: "available" as const,
            state: await this.provider.getState(threadId, {
              signal: controller.signal,
            }),
          }
        : await fetchRuntimeState({
            runtimeUrl: this.runtimeUrl,
            threadId,
            headers: this.headers,
            signal: controller.signal,
          });
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
      onDetailDividerDown: this.onDetailDividerDown,
      onDetailDividerMove: this.onDetailDividerMove,
      onDetailDividerUp: this.onDetailDividerUp,
      metadataStrip: this.renderMetadataStrip(),
      viewInAppAction: renderViewInAppAction(this),
      panelToggle: this.renderPanelToggle(),
      detailPanel: this.renderDetailPanel(),
      renderTabContent: (id) => this.renderTabContent(id),
    });
  }

  private renderMetadataStrip(): TemplateResult {
    return renderMetadataStrip(
      createThreadMetadataPills({
        metadata: this.metadata,
        fallbackName: this.thread?.name,
        threadId: this.threadId,
      }),
    );
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
      expandedTools: this._expandedTools,
      expandedMessages: this._expandedMessages,
      collapseThreshold: CpkThreadInspector.COLLAPSE_THRESHOLD,
      cache: this.panelTemplateCache,
      onToggleMessage: (id) => this.toggleMessageExpand(id),
      onToggleTool: (id) => this.toggleToolExpand(id),
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
