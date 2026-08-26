import { css, html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { marked } from "marked";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { ɵThread } from "@copilotkit/core";

import { PortableLitElement } from "./portable-lit-element.js";
import { ensureBrandFont } from "../lib/pop-out.js";
import {
  eventColors,
  formatTimestamp,
  highlightedJson,
  renderHighlightedJsonBlock,
} from "../lib/thread-debugger.js";
import type {
  ApiAgentEvent,
  ConversationAgentResponded,
  ConversationAssistant,
  ConversationGenerativeUIItem,
  ConversationItem,
  ConversationToolCall,
  ConversationUser,
  RenderItem,
  RuntimeEventsFetchResult,
  RuntimeStateFetchResult,
  ThreadDebuggerEvent,
  ThreadDebuggerMessage,
  ThreadDebuggerMetadata,
  ThreadDebuggerProvider,
  ThreadDetailsPanelCacheSlot,
  ThreadDetailsTab,
  TimelineItem,
  ToolCallGroup,
} from "../lib/thread-debugger.js";

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

  private static providerIds = new WeakMap<ThreadDebuggerProvider, number>();
  private static nextProviderId = 1;

  private static providerLoadKey(
    provider: ThreadDebuggerProvider | null,
  ): string {
    if (!provider) return "provider:none";
    let id = CpkThreadInspector.providerIds.get(provider);
    if (!id) {
      id = CpkThreadInspector.nextProviderId;
      CpkThreadInspector.nextProviderId += 1;
      CpkThreadInspector.providerIds.set(provider, id);
    }
    return [
      `provider:${id}`,
      provider.getThreadMetadata ? "metadata:1" : "metadata:0",
      provider.getMessages ? "messages:1" : "messages:0",
      provider.getEvents ? "events:1" : "events:0",
      provider.getState ? "state:1" : "state:0",
    ].join("|");
  }

  /**
   * Build a deterministic signature for runtime fetch headers so auth/CSRF
   * changes invalidate cached thread data even when the selected thread is
   * otherwise unchanged.
   */
  private static headersLoadKey(headers: Record<string, string>): string {
    return JSON.stringify(
      Object.entries(headers).sort(([leftKey], [rightKey]) =>
        leftKey.localeCompare(rightKey),
      ),
    );
  }

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

  static styles = css`
    @import url("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Spline+Sans+Mono:wght@400;500&display=swap");

    /* ── Root ────────────────────────────────────────────────────────── */
    :host {
      display: flex;
      flex-direction: row;
      overflow: hidden;
    }

    .cpk-td {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #ffffff;
    }

    /* ── Left area ───────────────────────────────────────────────────── */
    .cpk-td__left {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Tab bar header ──────────────────────────────────────────────── */
    .cpk-td__tabs-header {
      /* No top/right padding so tabs and toggle sit flush against the
         top and right edges of the inspector. */
      padding: 0 0 0 12px;
      border-bottom: 1px solid #dbdbe5;
      flex-shrink: 0;
      display: flex;
      align-items: stretch;
    }

    .cpk-td__tab-group {
      display: flex;
      gap: 0;
      margin-bottom: -1px;
      /* Allow the tab list to shrink rather than pushing the panel-toggle
         button past the right edge of the inspector when horizontal space
         gets tight (the drawer being open eats noticeably into width). */
      min-width: 0;
      flex-shrink: 1;
      overflow: hidden;
    }

    .cpk-td__tab {
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 500;
      padding: 10px 12px;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      background: transparent;
      color: #68686e;
      transition:
        color 0.12s,
        border-color 0.12s;
      white-space: nowrap;
    }

    .cpk-td__tab:hover {
      color: #010507;
    }

    .cpk-td__tab:focus-visible {
      outline: 2px solid #5558b2;
      outline-offset: -3px;
      border-radius: 5px;
    }

    .cpk-td__tab--active {
      color: #010507;
      border-bottom-color: #bec2ff;
    }

    /* Toggle is a separate control, not a tab — so it does NOT use the
       tabs' bottom-border active indicator. Instead, a subtle filled
       state communicates "the drawer is open," and a vertical separator
       on the left visually divorces it from the tab group. */
    .cpk-td__panel-toggle {
      margin-left: auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 12px;
      border: none;
      border-left: 1px solid #dbdbe5;
      background: transparent;
      color: #68686e;
      cursor: pointer;
      flex-shrink: 0;
      transition:
        color 0.12s,
        background 0.12s;
    }
    .cpk-td__panel-toggle:hover {
      color: #010507;
      background: #f4f4f9;
    }
    .cpk-td__panel-toggle--active {
      color: #5558b2;
      background: #eee6fe;
    }
    .cpk-td__panel-toggle--active:hover {
      background: #e4d8fc;
    }

    /* ── Scrollable content ──────────────────────────────────────────── */
    .cpk-td__content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* Pin direct children so expanded tool bodies don't get flex-shrunk. */
    .cpk-td__content > * {
      flex-shrink: 0;
    }

    .cpk-td__metadata-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      padding: 10px 16px;
      border-bottom: 1px solid #e9e9ef;
      background: #fbfbfd;
      flex-shrink: 0;
    }

    .cpk-td__metadata-pills {
      display: flex;
      gap: 6px;
      flex: 1;
      flex-wrap: wrap;
      min-width: 0;
    }

    .cpk-td__metadata-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 220px;
      padding: 3px 7px;
      border: 1px solid #e9e9ef;
      border-radius: 6px;
      background: #ffffff;
      color: #57575b;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      white-space: nowrap;
    }

    .cpk-td__metadata-label {
      color: #68686e;
      text-transform: uppercase;
      font-size: 9px;
    }

    .cpk-td__metadata-value {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .cpk-td__metadata-pill--wrap {
      max-width: 100%;
      white-space: normal;
    }

    .cpk-td__metadata-value--wrap {
      overflow: visible;
      text-overflow: clip;
      white-space: normal;
      overflow-wrap: anywhere;
    }

    .cpk-td__view-in-app {
      appearance: none;
      flex-shrink: 0;
      margin: 0;
      border: 1px solid #5558b2;
      border-radius: 6px;
      background: #5558b2;
      color: #ffffff;
      font-family: "Plus Jakarta Sans", sans-serif;
      font-size: 11px;
      font-weight: 600;
      padding: 5px 10px;
      cursor: pointer;
    }

    .cpk-td__view-in-app:focus-visible {
      outline: 2px solid #010507;
      outline-offset: 2px;
    }

    .cpk-td__view-in-app--stop {
      background: #ffffff;
      color: #5558b2;
    }

    .cpk-td__view-in-app-error {
      flex-basis: 100%;
      color: #c0333a;
      font-size: 11px;
    }

    /*
     * Each tab's content is wrapped in this panel so the keep-mounted
     * inactive panels can be hidden via display:none without disturbing
     * the gap between visible siblings. The flex column + gap gives each
     * conversation item / event row breathing room (the cpk-td__content
     * rule above no longer reaches them now that they are nested inside
     * the per-panel wrapper).
     */
    .cpk-td__panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cpk-td__panel > * {
      flex-shrink: 0;
    }

    .cpk-td__panel[hidden] {
      display: none;
    }

    /* ── Empty state ─────────────────────────────────────────────────── */
    .cpk-td__empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: #68686e;
      font-size: 13px;
      padding: 40px 0;
    }

    .cpk-td__empty-hint {
      font-size: 11px;
      color: #68686e;
      text-align: center;
      max-width: 220px;
      line-height: 1.5;
    }

    /* ── Status messages ─────────────────────────────────────────────── */
    .cpk-td__status {
      padding: 16px;
      font-size: 12px;
      color: #68686e;
      text-align: center;
    }

    .cpk-td__status--error {
      color: #c0333a;
    }

    @keyframes cpk-td-focus-pulse {
      0% {
        outline-color: rgba(100, 48, 171, 0);
        box-shadow: 0 0 0 rgba(100, 48, 171, 0);
        animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
      }
      24%,
      50% {
        outline-color: rgba(100, 48, 171, 0.78);
        box-shadow: 0 7px 20px rgba(100, 48, 171, 0.2);
      }
      100% {
        outline-color: rgba(100, 48, 171, 0);
        box-shadow: 0 0 0 rgba(100, 48, 171, 0);
      }
    }

    .cpk-td__focus-pulse {
      position: relative;
      z-index: 1;
      outline: 2px solid transparent;
      outline-offset: 3px;
      animation: cpk-td-focus-pulse 760ms linear;
    }

    @media (prefers-reduced-motion: reduce) {
      .cpk-td__focus-pulse {
        animation-duration: 320ms;
      }
    }

    /* ── Conversation bubbles ────────────────────────────────────────── */
    .cpk-td__bubble {
      display: flex;
      margin-bottom: 2px;
    }

    .cpk-td__bubble--user {
      justify-content: flex-end;
    }

    .cpk-td__bubble--assistant {
      justify-content: flex-start;
    }

    .cpk-td__bubble-inner {
      padding: 9px 14px;
      max-width: 75%;
      font-size: 13px;
      line-height: 1.55;
    }

    .cpk-td__bubble-inner--user {
      background: #eee6fe;
      color: #57575b;
      border-radius: 12px 12px 4px 12px;
    }

    .cpk-td__show-more {
      display: inline-block;
      margin-top: 4px;
      font-size: 11px;
      font-weight: 500;
      color: #57575b;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .cpk-td__bubble-inner--assistant {
      background: #f7f7f9;
      color: #010507;
      border-radius: 12px 12px 12px 4px;
      border: 1px solid #e9e9ef;
    }

    /* ── Tool call blocks ────────────────────────────────────────────── */
    .cpk-td__tool-block {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
    }

    .cpk-td__tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(133, 236, 206, 0.15);
      cursor: pointer;
      font-size: 11px;
      user-select: none;
    }

    .cpk-td__tool-header:hover {
      background: rgba(133, 236, 206, 0.22);
    }

    .cpk-td__tool-name {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #087653;
      text-transform: uppercase;
      flex: 1;
    }

    .cpk-td__tool-status {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
      color: #087653;
    }

    .cpk-td__tool-status--pending {
      color: #8a5900;
    }

    .cpk-td__tool-chevron {
      color: #68686e;
      font-size: 10px;
    }

    .cpk-td__tool-body {
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
      background: #ffffff;
    }

    .cpk-td__tool-section-label {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      color: #68686e;
      text-transform: uppercase;
      margin-bottom: 4px;
      letter-spacing: 0.3px;
    }

    .cpk-td__tool-pre {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      background: #f7f7f9;
      padding: 6px 8px;
      border-radius: 5px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: #010507;
      line-height: 1.6;
    }

    /* ── Tool call group ─────────────────────────────────────────────── */
    .cpk-td__tool-group {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
    }

    .cpk-td__tool-group-header {
      padding: 5px 10px;
      background: rgba(133, 236, 206, 0.15);
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      color: #087653;
      text-transform: uppercase;
      font-weight: 500;
      border-bottom: 1px solid #e9e9ef;
    }

    .cpk-td__tool-group .cpk-td__tool-block {
      border: none;
      border-bottom: 1px solid #e9e9ef;
      border-radius: 0;
    }

    .cpk-td__tool-group .cpk-td__tool-block:last-child {
      border-bottom: none;
    }

    /* ── Inline chips (reasoning / state update) ─────────────────────── */
    .cpk-td__inline-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0;
      color: #68686e;
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-transform: uppercase;
    }

    .cpk-td__inline-chip::before,
    .cpk-td__inline-chip::after {
      content: "";
      flex: 1;
      height: 1px;
      background: #e9e9ef;
    }

    /* ── Interaction timeline ───────────────────────────────────────── */
    .cpk-td__timeline-item {
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      background: #ffffff;
      overflow: hidden;
    }

    .cpk-td__timeline-item--warning {
      border-color: rgba(250, 95, 103, 0.35);
      background: rgba(250, 95, 103, 0.04);
    }

    .cpk-td__timeline-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      background: #f7f7f9;
    }

    .cpk-td__timeline-kind {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      color: #5558b2;
    }

    .cpk-td__timeline-title {
      flex: 1;
      min-width: 0;
      font-size: 12px;
      font-weight: 500;
      color: #010507;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cpk-td__timeline-time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #68686e;
      flex-shrink: 0;
    }

    .cpk-td__timeline-body {
      margin: 0;
      padding: 0 10px 9px;
      font-size: 12px;
      line-height: 1.55;
      color: #57575b;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .cpk-td__timeline-toolbar {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }

    .cpk-td__timeline-bulk-toggle {
      margin: 0;
      padding: 4px 8px;
      border: 1px solid #dcdce8;
      border-radius: 7px;
      background: #ffffff;
      color: #36363a;
      cursor: pointer;
      font-family: "Inter", sans-serif;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.2;
    }

    .cpk-td__timeline-bulk-toggle:hover {
      border-color: rgba(85, 88, 178, 0.38);
      background: #f7f7ff;
      color: #010507;
    }

    .cpk-td__timeline-bulk-toggle:disabled {
      cursor: not-allowed;
      opacity: 0.45;
    }

    .cpk-td__source-link {
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      color: #5558b2;
      cursor: pointer;
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      text-decoration: underline;
      text-underline-offset: 2px;
      flex-shrink: 0;
    }

    .cpk-td__source-link:hover {
      color: #010507;
    }

    .cpk-td__timeline-details-toggle {
      margin: 0;
      padding: 5px 10px;
      border: none;
      background: #ffffff;
      color: #5558b2;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-family: "Inter", sans-serif;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
      width: 100%;
    }

    .cpk-td__timeline-details-toggle:hover {
      background: #f7f7ff;
      color: #010507;
    }

    .cpk-td__timeline-details-toggle svg {
      width: 12px;
      height: 12px;
      stroke-width: 2;
    }

    /* ── Generative UI ──────────────────────────────────────────────── */
    @keyframes cpk-genui-enter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes cpk-playground-message-enter {
      from {
        opacity: 0;
        filter: blur(2px);
        transform: translateY(4px);
      }
      to {
        opacity: 1;
        filter: blur(0);
        transform: translateY(0);
      }
    }

    @keyframes cpk-playground-thinking {
      0%,
      60%,
      100% {
        opacity: 0.28;
        transform: translateY(0);
      }
      30% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }

    .cpk-playground-root {
      container-type: inline-size;
    }

    .cpk-playground-message-enter {
      animation: cpk-playground-message-enter 0.24s cubic-bezier(0.16, 1, 0.3, 1)
        both;
    }

    .cpk-playground-thinking-dot {
      animation: cpk-playground-thinking 1.2s ease-in-out infinite;
    }

    .cpk-playground-thinking-dot:nth-child(2) {
      animation-delay: 0.12s;
    }

    .cpk-playground-thinking-dot:nth-child(3) {
      animation-delay: 0.24s;
    }

    .cpk-playground-reasoning summary::-webkit-details-marker {
      display: none;
    }

    .cpk-playground-reasoning[open] .cpk-playground-reasoning-chevron {
      transform: rotate(90deg);
    }

    @container (max-width: 560px) {
      .cpk-playground-header {
        align-items: stretch;
      }

      .cpk-playground-actions {
        width: 100%;
      }

      .cpk-playground-thread-select {
        min-width: 0;
        max-width: none;
        flex: 1;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .cpk-playground-message-enter,
      .cpk-playground-thinking-dot {
        animation: none;
      }
    }

    .cpk-td__genui {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 16px 8px;
      animation: cpk-genui-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    .cpk-td__genui-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 5px;
      background: #eee6fe;
      color: #57575b;
      font-size: 10px;
      font-weight: 600;
      align-self: flex-start;
    }

    .cpk-td__genui-card {
      overflow: hidden;
      border-radius: 14px;
      border: 1px solid #e2e8f0;
      background: #fff;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08);
    }

    .cpk-td__genui-placeholder {
      padding: 8px 12px;
      border-radius: 10px;
      border: 1px solid #ede9fe;
      background: #f5f3ff;
      color: #7c3aed;
      font-size: 11px;
    }

    /* ── AG-UI Events ────────────────────────────────────────────────── */
    .cpk-td__event {
      flex-shrink: 0;
      border: 1px solid #e9e9ef;
      border-radius: 7px;
      overflow: hidden;
      /*
       * content-visibility: auto lets the browser skip layout + paint for
       * off-screen events while keeping them in the DOM (so scroll size
       * stays correct). Without this, switching back to AG-UI Events on a
       * thread with hundreds of events triggers a full layout pass over
       * every event row, which on Martha's intelligence-backed example
       * shows up as a multi-second freeze each time the panel becomes
       * visible. The intrinsic-size hint avoids the visible jump as the
       * browser swaps in real heights when items scroll into view.
       */
      content-visibility: auto;
      contain-intrinsic-size: 0 80px;
    }

    .cpk-td__event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 5px 10px;
    }

    .cpk-td__event-type {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .cpk-td__event-time {
      font-family: "Spline Sans Mono", monospace;
      font-size: 9px;
      color: #68686e;
    }

    .cpk-td__event-payload {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
      padding: 8px 10px;
      border-top: 1px solid #e9e9ef;
    }

    /* ── JSON block (agent state) ────────────────────────────────────── */
    .cpk-td__json-block,
    .cpk-json-block {
      margin: 0;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      line-height: 1.8;
      white-space: pre-wrap;
      word-break: break-all;
      color: #57575b;
    }

    /* ── Resize divider ──────────────────────────────────────────────── */
    /* Floats over the drawer's left edge so the toggle and the drawer
       touch directly without a 4px flex-gap between them. The hit zone
       is wider than its visual hint to make it easy to grab. */
    .cpk-td__detail-divider {
      position: absolute;
      top: 0;
      bottom: 0;
      left: -3px;
      width: 7px;
      cursor: col-resize;
      background: transparent;
      z-index: 5;
    }

    .cpk-td__detail-divider:hover {
      background: rgba(190, 194, 255, 0.3);
    }

    /* ── Right detail panel ──────────────────────────────────────────── */
    .cpk-td__detail {
      flex-shrink: 0;
      overflow: hidden;
      background: #f7f7f9;
      display: flex;
      flex-direction: column;
      gap: 0;
      padding: 0;
      box-sizing: border-box;
      position: relative;
      /* Slide open/closed via width + padding transition. When closed,
         width and padding are 0 so the drawer fully collapses. */
      transition:
        width 220ms cubic-bezier(0.4, 0, 0.2, 1),
        padding 220ms cubic-bezier(0.4, 0, 0.2, 1);
    }

    .cpk-td__detail[data-open="true"] {
      overflow-y: auto;
      padding: 16px;
    }

    .cpk-tdp__section-title {
      font-family: "Spline Sans Mono", monospace;
      font-size: 10px;
      font-weight: 500;
      color: #68686e;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      margin-bottom: 8px;
    }

    .cpk-tdp__divider {
      height: 1px;
      background: #dbdbe5;
      margin: 14px 0;
    }

    .cpk-tdp__row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 3px 0;
      gap: 8px;
    }

    .cpk-tdp__label {
      color: #68686e;
      font-size: 11px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .cpk-tdp__value {
      color: #010507;
      font-family: "Spline Sans Mono", monospace;
      font-size: 11px;
      text-align: right;
      min-width: 0;
    }

    .cpk-tdp__value--truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 130px;
    }

    .cpk-tdp__value--wrap {
      white-space: normal;
      word-break: break-all;
      text-align: right;
    }

    :host([data-color-scheme="dark"]) {
      color-scheme: dark;
    }

    :host([data-color-scheme="dark"]) .cpk-td {
      background: #111319;
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tabs-header,
    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
    :host([data-color-scheme="dark"]) .cpk-td__tool-block,
    :host([data-color-scheme="dark"]) .cpk-td__tool-header,
    :host([data-color-scheme="dark"]) .cpk-td__tool-body,
    :host([data-color-scheme="dark"]) .cpk-td__event,
    :host([data-color-scheme="dark"]) .cpk-td__event-payload,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
      border-color: #343742;
    }

    :host([data-color-scheme="dark"]) .cpk-td__metadata-strip,
    :host([data-color-scheme="dark"]) .cpk-td__detail {
      background: #15171e;
    }

    :host([data-color-scheme="dark"]) .cpk-td__metadata-pill,
    :host([data-color-scheme="dark"]) .cpk-td__bubble-inner--assistant,
    :host([data-color-scheme="dark"]) .cpk-td__tool-block,
    :host([data-color-scheme="dark"]) .cpk-td__event,
    :host([data-color-scheme="dark"]) .cpk-td__genui-card,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-item,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle {
      border-color: #343742;
      background: #191c24;
    }

    :host([data-color-scheme="dark"]) .cpk-td__timeline-header,
    :host([data-color-scheme="dark"]) .cpk-td__tool-body,
    :host([data-color-scheme="dark"]) .cpk-td__tool-pre {
      background: #171a22;
    }

    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle:hover,
    :host([data-color-scheme="dark"]) .cpk-td__tool-header:hover,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle:hover,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle:hover {
      background: #20232d;
    }

    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle--active,
    :host([data-color-scheme="dark"]) .cpk-td__inline-chip,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-kind,
    :host([data-color-scheme="dark"]) .cpk-td__genui-badge {
      background: #302b43;
      color: #d8d9ff;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tab,
    :host([data-color-scheme="dark"]) .cpk-td__panel-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-label,
    :host([data-color-scheme="dark"]) .cpk-td__event-time,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-time,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-body,
    :host([data-color-scheme="dark"]) .cpk-tdp__label,
    :host([data-color-scheme="dark"]) .cpk-tdp__section-title {
      color: #aeb1bd;
    }

    :host([data-color-scheme="dark"]) .cpk-td__tab:hover,
    :host([data-color-scheme="dark"]) .cpk-td__tab--active,
    :host([data-color-scheme="dark"]) .cpk-td__metadata-value,
    :host([data-color-scheme="dark"]) .cpk-td__tool-name,
    :host([data-color-scheme="dark"]) .cpk-td__tool-pre,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-title,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-bulk-toggle,
    :host([data-color-scheme="dark"]) .cpk-td__timeline-details-toggle,
    :host([data-color-scheme="dark"]) .cpk-tdp__value {
      color: #f3f4f8;
    }

    :host([data-color-scheme="dark"]) .cpk-td__event-payload,
    :host([data-color-scheme="dark"]) .cpk-td__json-block,
    :host([data-color-scheme="dark"]) .cpk-json-block {
      color: #c7c9d2;
    }

    :host([data-color-scheme="dark"]) .cpk-tdp__divider {
      background: #343742;
    }
  `;

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
        void this.fetchMetadata(this.threadId);
        if (this.canFetchEvents()) {
          this._eventsFetched = true;
          void this.fetchEvents(this.threadId);
        } else {
          // Last-resort compatibility path for consumers that only implement
          // messages. New integrations should provide events so Timeline can
          // expose source references and decode warnings.
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
    return (
      !!this.provider?.getMessages ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private canFetchEvents(): boolean {
    return (
      !!this.provider?.getEvents ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private canFetchState(): boolean {
    return (
      !!this.provider?.getState ||
      (!!this.runtimeUrl && this.threadInspectionAvailable)
    );
  }

  private currentLoadKey(): string {
    return [
      this.threadId ?? "thread:none",
      CpkThreadInspector.providerLoadKey(this.provider),
      `runtime:${this.runtimeUrl}`,
      `headers:${CpkThreadInspector.headersLoadKey(this.headers)}`,
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
      this._conversation = this.mapMessages(messages);
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
        if (this.canFetchMessages()) {
          void this.fetchMessages(threadId);
        }
        return;
      }
      const mappedEvents = this.mapApiEvents(result.events);
      this._fetchedEvents = mappedEvents;
      if (mappedEvents.length === 0 && this.canFetchMessages()) {
        void this.fetchMessages(threadId);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      if (this.threadId !== threadId) return;
      this._eventsError =
        err instanceof Error ? err.message : "Failed to load events";
      this._fetchedEvents = [];
      if (this.canFetchMessages()) {
        void this.fetchMessages(threadId);
      }
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
    const res = await fetch(this.getThreadInspectionUrl(threadId, "messages"), {
      headers: { ...this.headers },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { messages: ThreadDebuggerMessage[] };
    return data.messages;
  }

  private async fetchRuntimeEvents(
    threadId: string,
    signal: AbortSignal,
  ): Promise<RuntimeEventsFetchResult> {
    const res = await fetch(this.getThreadInspectionUrl(threadId, "events"), {
      headers: { ...this.headers },
      signal,
    });
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
    const res = await fetch(this.getThreadInspectionUrl(threadId, "state"), {
      headers: { ...this.headers },
      signal,
    });
    if (res.status === 501) {
      return { status: "not-available" };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      state: Record<string, unknown> | null;
    };
    return { status: "available", state: data.state ?? null };
  }

  private getThreadInspectionUrl(
    threadId: string,
    resource: "messages" | "events" | "state",
  ): string {
    return `${this.runtimeUrl.replace(/\/+$/, "")}/threads/${encodeURIComponent(threadId)}/${resource}`;
  }

  private mapMessages(messages: ThreadDebuggerMessage[]): ConversationItem[] {
    const items: ConversationItem[] = [];
    const toolCallMap = new Map<string, ConversationToolCall>();
    for (const msg of messages) {
      if (msg.role === "user" && msg.content) {
        items.push({
          id: msg.id,
          type: "user",
          content: msg.content,
          createdAt: "",
        });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls?.length) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown> = {};
            if (typeof tc.args === "string") {
              try {
                args = this.parseToolCallContent(tc.args);
              } catch (err) {
                // Empty content is normalized to `{}` for both tool arguments
                // and results. The inspector still surfaces malformed JSON.
                console.error(
                  "[CopilotKit Inspector] Failed to parse tool-call arguments",
                  { toolCallId: tc.id, raw: tc.args, error: err },
                );
                args = { __parseError: true, __raw: tc.args };
              }
            } else {
              args = tc.args;
            }
            const item: ConversationToolCall = {
              id: tc.id,
              type: "tool_call",
              toolName: tc.name,
              toolCallId: tc.id,
              arguments: args,
              result: null,
              createdAt: "",
            };
            toolCallMap.set(tc.id, item);
            items.push(item);
          }
        }
        if (msg.content) {
          items.push({
            id: msg.id,
            type: "assistant",
            content: msg.content,
            createdAt: "",
          });
        }
      } else if (msg.role === "activity") {
        items.push({
          id: msg.id,
          type: "generative-ui",
          activityType: msg.activityType ?? "unknown",
          createdAt: "",
        });
      } else if (msg.role === "tool" && msg.toolCallId) {
        const tc = toolCallMap.get(msg.toolCallId);
        if (tc) {
          try {
            tc.result = this.parseToolCallContent(msg.content);
          } catch (err) {
            // See the comment on the assistant tool-call args parse above —
            // same rationale, same sentinel shape so the renderer can treat
            // both consistently.
            console.error(
              "[CopilotKit Inspector] Failed to parse tool-call result content",
              { toolCallId: msg.toolCallId, raw: msg.content, error: err },
            );
            tc.result = { __parseError: true, __raw: msg.content ?? null };
          }
        }
      }
    }
    return items;
  }

  private parseToolCallContent(
    content: string | null | undefined,
  ): Record<string, unknown> {
    const normalizedContent = content?.trim();
    if (!normalizedContent) {
      return {};
    }

    return JSON.parse(normalizedContent) as Record<string, unknown>;
  }

  private mapApiEvents(events: ThreadDebuggerEvent[]): ApiAgentEvent[] {
    return events.map((event, index) => {
      const { type, timestamp, payload, ...rest } = event;
      return {
        type: typeof type === "string" ? type : "UNKNOWN",
        timestamp:
          typeof timestamp === "string" || typeof timestamp === "number"
            ? timestamp
            : Date.now(),
        payload: payload ?? rest,
        sourceIndex: index + 1,
        rawEvent: event,
      };
    });
  }

  private get activeTimelineItems(): TimelineItem[] {
    return this.timelineItemsForEvents(this.activeEvents);
  }

  private timelineItemsForEvents(events: ApiAgentEvent[]): TimelineItem[] {
    if (this._timelineItemsCache?.events === events) {
      return this._timelineItemsCache.items;
    }
    const items = this.timelineItemsFromEvents(events);
    this._timelineItemsCache = { events, items };
    return items;
  }

  private timelineItemsFromEvents(events: ApiAgentEvent[]): TimelineItem[] {
    if (events.length === 0) return [];

    const items: TimelineItem[] = [];
    const messageItems = new Map<string, TimelineItem>();
    const toolItems = new Map<string, TimelineItem & { rawArgs?: string }>();

    const readString = (
      payload: Record<string, unknown>,
      keys: string[],
    ): string | null => {
      for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string") return value;
      }
      return null;
    };

    const sourceIndexFor = (event: ApiAgentEvent): number =>
      event.sourceIndex ?? 0;

    const appendWarning = (
      event: ApiAgentEvent,
      title: string,
      body: string,
      severity: "warning" | "error" = "warning",
    ): void => {
      const sourceIndex = sourceIndexFor(event);
      items.push({
        id: `warning-${sourceIndex}-${items.length}`,
        kind: "warning",
        title,
        body,
        timestamp: event.timestamp,
        sourceIndex,
        severity,
      });
    };

    const ensureMessage = (
      event: ApiAgentEvent,
      role: string,
    ): TimelineItem => {
      const sourceIndex = sourceIndexFor(event);
      const key =
        readString(event.payload, ["messageId", "message_id", "id"]) ??
        `message-${sourceIndex}`;
      let item = messageItems.get(key);
      if (!item) {
        item = {
          id: `message-${key}`,
          messageId: key,
          kind: "message",
          title: `${role || "message"} message`,
          body: "",
          timestamp: event.timestamp,
          sourceIndex,
        };
        messageItems.set(key, item);
        items.push(item);
      }
      return item;
    };

    const ensureTool = (
      event: ApiAgentEvent,
    ): TimelineItem & {
      rawArgs?: string;
    } => {
      const sourceIndex = sourceIndexFor(event);
      const key =
        readString(event.payload, [
          "toolCallId",
          "tool_call_id",
          "id",
          "callId",
        ]) ?? `tool-${sourceIndex}`;
      let item = toolItems.get(key);
      if (!item) {
        item = {
          id: `tool-${key}`,
          kind: "tool",
          title:
            readString(event.payload, [
              "toolCallName",
              "toolName",
              "name",
              "functionName",
            ]) ?? "Tool call",
          body: "",
          timestamp: event.timestamp,
          sourceIndex,
        };
        toolItems.set(key, item);
        items.push(item);
      }
      return item;
    };

    for (const event of events) {
      const { type, payload } = event;
      const sourceIndex = sourceIndexFor(event);

      if (type === "UNKNOWN") {
        appendWarning(
          event,
          "Unknown AG-UI event",
          "The event is missing a string type and could not be normalized.",
        );
        continue;
      }

      if (type === "RUN_STARTED" || type === "STEP_STARTED") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "run",
          title: type === "RUN_STARTED" ? "Run started" : "Step started",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      if (type === "RUN_FINISHED" || type === "STEP_FINISHED") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "run",
          title: type === "RUN_FINISHED" ? "Run finished" : "Step finished",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      if (type === "RUN_ERROR" || type === "ERROR") {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "warning",
          title: "Run error",
          body: readString(payload, ["message", "error", "description"]) ?? "",
          timestamp: event.timestamp,
          sourceIndex,
          severity: "error",
          details: payload,
        });
        continue;
      }

      if (type === "TEXT_MESSAGE_START") {
        ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
        continue;
      }

      if (type === "TEXT_MESSAGE_CONTENT") {
        const item = ensureMessage(
          event,
          readString(payload, ["role"]) ?? "assistant",
        );
        item.body = `${item.body ?? ""}${
          readString(payload, ["delta", "content", "text"]) ?? ""
        }`;
        continue;
      }

      if (type === "TEXT_MESSAGE_END") {
        ensureMessage(event, readString(payload, ["role"]) ?? "assistant");
        continue;
      }

      if (type === "TOOL_CALL_START") {
        ensureTool(event);
        continue;
      }

      if (type === "TOOL_CALL_ARGS") {
        const item = ensureTool(event);
        const chunk =
          readString(payload, ["args", "arguments", "delta"]) ??
          (typeof payload.args === "object"
            ? JSON.stringify(payload.args)
            : null);
        if (chunk) {
          item.rawArgs = `${item.rawArgs ?? ""}${chunk}`;
          item.body = item.rawArgs;
        }
        continue;
      }

      if (type === "TOOL_CALL_END") {
        const item = ensureTool(event);
        if (item.rawArgs) {
          try {
            JSON.parse(item.rawArgs);
          } catch {
            appendWarning(
              event,
              "Could not decode tool call arguments",
              item.rawArgs,
            );
          }
        }
        continue;
      }

      if (type === "TOOL_CALL_RESULT") {
        const item = ensureTool(event);
        const result = readString(payload, ["result", "content", "delta"]);
        if (result) {
          item.body = item.body
            ? `${item.body}\nResult: ${result}`
            : `Result: ${result}`;
          try {
            JSON.parse(result);
          } catch {
            appendWarning(event, "Could not decode tool result", result);
          }
        }
        continue;
      }

      if (type.startsWith("STATE_")) {
        items.push({
          id: `${type}-${sourceIndex}`,
          kind: "state",
          title:
            type === "STATE_SNAPSHOT"
              ? "State snapshot captured"
              : "State delta captured",
          timestamp: event.timestamp,
          sourceIndex,
          details: payload,
        });
        continue;
      }

      items.push({
        id: `event-${sourceIndex}`,
        kind: "event",
        title: type,
        timestamp: event.timestamp,
        sourceIndex,
        details: payload,
      });
    }

    return items;
  }

  private get renderItems(): RenderItem[] {
    const items = this._conversation;
    const result: RenderItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (item.type === "agent_responded") continue;
      if (item.type !== "tool_call" || !item.groupId) {
        result.push(item);
        continue;
      }
      if (seen.has(item.groupId)) continue;
      seen.add(item.groupId);
      const group: ToolCallGroup = {
        type: "tool_call_group",
        id: item.groupId,
        items: items.filter(
          (i): i is ConversationToolCall =>
            i.type === "tool_call" && i.groupId === item.groupId,
        ),
      };
      result.push(group);
    }
    return result;
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

  private rawEventId(event: ApiAgentEvent): string {
    return `raw-event-${event.sourceIndex ?? event.timestamp ?? event.type}`;
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

  private hasRenderableState(): boolean {
    const s = this.activeState;
    return !!s && typeof s === "object" && Object.keys(s).length > 0;
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
      { label: "ID", value: metadata?.id ?? this.threadId ?? "—", wrap: true },
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
    const bulkControls = this.renderActiveBulkControls();

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
        ${this.renderViewInAppAction()}
        ${bulkControls}
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

  private renderActiveBulkControls() {
    if (this._eventsNotAvailable) return nothing;
    if (this._tab === "raw-events") return this.renderRawEventBulkControls();
    if (this._tab !== "timeline") return nothing;

    const detailIds = this.timelineItemsForEvents(this.activeEvents)
      .filter((item) => item.details)
      .map((item) => item.id);
    if (detailIds.length <= 1) return nothing;

    const allExpanded = detailIds.every((id) =>
      this._expandedTimelineDetails.has(id),
    );
    const allCollapsed = detailIds.every(
      (id) => !this._expandedTimelineDetails.has(id),
    );

    return html`<div class="cpk-td__timeline-toolbar">
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allExpanded}
        @click=${() => this.expandTimelineDetails(detailIds)}
      >
        Expand all
      </button>
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allCollapsed}
        @click=${() => this.collapseTimelineDetails(detailIds)}
      >
        Collapse all
      </button>
    </div>`;
  }

  private renderRawEventBulkControls() {
    const eventIds = this.activeEvents.map((event) => this.rawEventId(event));
    if (eventIds.length <= 1) return nothing;

    const allExpanded = eventIds.every((id) => this._expandedRawEvents.has(id));
    const allCollapsed = eventIds.every(
      (id) => !this._expandedRawEvents.has(id),
    );

    return html`<div class="cpk-td__timeline-toolbar">
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allExpanded}
        @click=${() => this.expandRawEventDetails(eventIds)}
      >
        Expand all
      </button>
      <button
        type="button"
        class="cpk-td__timeline-bulk-toggle"
        ?disabled=${allCollapsed}
        @click=${() => this.collapseRawEventDetails(eventIds)}
      >
        Collapse all
      </button>
    </div>`;
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
      if (this._conversation.length > 0) return this.renderConversation();
      if (this._loadingMessages) return this.renderConversation();
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
    const cachedTimeline = this.getCachedPanelTpl("timeline", [
      events,
      this._expandedTimelineDetails,
    ]);
    if (cachedTimeline) return cachedTimeline;

    const timelineItems = this.timelineItemsForEvents(events);
    if (timelineItems.length === 0) {
      if (this._conversation.length > 0) return this.renderConversation();
      if (this._loadingMessages) return this.renderConversation();
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

    return this.cachedPanelTpl(
      "timeline",
      [events, this._expandedTimelineDetails],
      () => html`${timelineItems.map((item) => this.renderTimelineItem(item))}`,
    );
  }

  private renderTimelineItem(item: TimelineItem) {
    const isWarning = item.kind === "warning";
    const detailsExpanded = this._expandedTimelineDetails.has(item.id);
    return html`
      <div
        class="cpk-td__timeline-item ${
          isWarning ? "cpk-td__timeline-item--warning" : ""
        }"
        data-message-id=${item.messageId ?? nothing}
      >
        <div class="cpk-td__timeline-header">
          <span class="cpk-td__timeline-kind"
            >${item.severity === "error" ? "error" : item.kind}</span
          >
          <span class="cpk-td__timeline-title">${item.title}</span>
          <button
            type="button"
            class="cpk-td__source-link"
            @click=${() => this.revealSourceEvent(item.sourceIndex)}
          >
            Source event #${item.sourceIndex}
          </button>
          <span class="cpk-td__timeline-time"
            >${formatTimestamp(item.timestamp)}</span
          >
        </div>
        ${
          item.details
            ? html`<button
              type="button"
              class="cpk-td__timeline-details-toggle"
              aria-expanded=${detailsExpanded ? "true" : "false"}
              @click=${() => this.toggleTimelineDetails(item.id)}
            >
              ${
                detailsExpanded
                  ? html`
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    `
                  : html`
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    `
              }
              <span>${detailsExpanded ? "Hide details" : "Show details"}</span>
            </button>`
            : nothing
        }
        ${
          item.body
            ? html`<div class="cpk-td__timeline-body">${item.body}</div>`
            : nothing
        }
        ${
          item.details && detailsExpanded
            ? html`<pre class="cpk-td__timeline-body">
${unsafeHTML(highlightedJson(item.details))}</pre
            >`
            : nothing
        }
      </div>
    `;
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
    // Expand state is part of the cache key because clicking a tool-call
    // header or the "Show more" button on a long message replaces
    // `_expandedTools` / `_expandedMessages` without touching
    // `_conversation` — without those keys the cache returns the
    // pre-toggle template and the disclosure appears broken.
    return this.cachedPanelTpl(
      "timeline-fallback",
      [this._conversation, this._expandedTools, this._expandedMessages],
      () => {
        const items = this.renderItems;
        return html`${items.map((item) => this.renderRenderItem(item))}`;
      },
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

  private renderRenderItem(item: RenderItem) {
    switch (item.type) {
      case "user":
      case "assistant":
        return this.renderBubble(item);
      case "tool_call":
        return this.renderToolBlock(item);
      case "tool_call_group":
        return this.renderToolGroup(item);
      case "reasoning":
        return html`<div class="cpk-td__inline-chip">
          <span>Reasoned for ${item.duration}</span>
        </div>`;
      case "state_update":
        return html`
          <div class="cpk-td__inline-chip">
            <span>Updated agent state</span>
          </div>
        `;
      case "generative-ui":
        return this.renderGenerativeUI(item);
      case "agent_responded":
        return nothing;
    }
  }

  private renderBubble(item: ConversationUser | ConversationAssistant) {
    const isUser = item.type === "user";
    const threshold = CpkThreadInspector.COLLAPSE_THRESHOLD;
    const expanded = this._expandedMessages.has(item.id);
    const tooLong = item.content.length > threshold;
    const shown =
      tooLong && !expanded
        ? item.content.slice(0, threshold) + "…"
        : item.content;
    return html`
      <div
        class="cpk-td__bubble ${
          isUser ? "cpk-td__bubble--user" : "cpk-td__bubble--assistant"
        }"
        data-message-id=${item.id}
      >
        <div
          class="cpk-td__bubble-inner ${
            isUser
              ? "cpk-td__bubble-inner--user"
              : "cpk-td__bubble-inner--assistant"
          }"
        >
          ${shown}
          ${
            tooLong
              ? html`<span
                class="cpk-td__show-more"
                @click=${() => this.toggleMessageExpand(item.id)}
                >${expanded ? "Show less" : "Show more"}</span
              >`
              : nothing
          }
        </div>
      </div>
    `;
  }

  private renderToolBlock(item: ConversationToolCall) {
    const expanded = this._expandedTools.has(item.id);
    return html`
      <div class="cpk-td__tool-block">
        <div
          class="cpk-td__tool-header"
          @click=${() => this.toggleToolExpand(item.id)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M1 9C1 9 2 7 5 7C8 7 9 9 9 9M5 1C5 1 7 2.5 7 4.5C7 6.5 5 7 5 7C5 7 3 6.5 3 4.5C3 2.5 5 1 5 1Z"
              stroke="#087653"
              stroke-width="1.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="cpk-td__tool-name">${item.toolName}</span>
          ${
            item.result || Object.keys(item.arguments).length > 0
              ? html`
                  <span class="cpk-td__tool-status">DONE</span>
                `
              : html`
                  <span class="cpk-td__tool-status cpk-td__tool-status--pending">PENDING</span>
                `
          }
          <span class="cpk-td__tool-chevron">${expanded ? "▾" : "▸"}</span>
        </div>
        ${
          expanded
            ? html`
              <div class="cpk-td__tool-body">
                <div class="cpk-td__tool-section-label">Arguments</div>
                <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.arguments))}</pre
                >
                ${
                  item.result
                    ? html`
                      <div
                        class="cpk-td__tool-section-label"
                        style="margin-top:8px"
                      >
                        Result
                      </div>
                      <pre class="cpk-td__tool-pre">
${unsafeHTML(highlightedJson(item.result))}</pre
                      >
                    `
                    : nothing
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }

  private renderToolGroup(group: ToolCallGroup) {
    return html`
      <div class="cpk-td__tool-group">
        <div class="cpk-td__tool-group-header">
          ${group.items.length} tool call${group.items.length !== 1 ? "s" : ""}
        </div>
        ${group.items.map((tc) => this.renderToolBlock(tc))}
      </div>
    `;
  }

  private renderGenerativeUI(item: ConversationGenerativeUIItem) {
    return html`
      <div class="cpk-td__genui">
        <div class="cpk-td__genui-badge">
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Generative UI
        </div>
        <div class="cpk-td__genui-placeholder">
          ${item.activityType} — rendered in chat
        </div>
      </div>
    `;
  }

  private renderState() {
    if (this._loadingState) {
      return html`
        <div class="cpk-td__status">Loading state…</div>
      `;
    }
    if (this._stateError) {
      return html`<div class="cpk-td__status cpk-td__status--error">
        ${this._stateError}
      </div>`;
    }
    if (this._stateNotAvailable) {
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
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>State history not available</span>
          <span class="cpk-td__empty-hint"
            >This runtime doesn't yet expose per-thread agent state. Available when
            running against the in-memory runner.</span
          >
        </div>
      `;
    }
    if (!this.hasRenderableState()) {
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
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
          <span>No state captured</span>
          <span class="cpk-td__empty-hint"
            >Emitted live from STATE_SNAPSHOT events.</span
          >
        </div>
      `;
    }
    const stateValue = this.activeState;
    return this.cachedPanelTpl("state", [stateValue], () => {
      return renderHighlightedJsonBlock(stateValue);
    });
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
      () => {
        return html`${events.map((event) => {
          const { bg, fg } = eventColors(event.type);
          const eventId = this.rawEventId(event);
          const detailsExpanded = this._expandedRawEvents.has(eventId);
          return html`
            <div class="cpk-td__event" data-source-index=${event.sourceIndex}>
              <div class="cpk-td__event-header" style="background:${bg}">
                <span class="cpk-td__event-type" style="color:${fg}"
                  >${event.type}</span
                >
                <span class="cpk-td__event-time"
                  >${formatTimestamp(event.timestamp)}</span
                >
              </div>
              <button
                type="button"
                class="cpk-td__timeline-details-toggle"
                aria-expanded=${detailsExpanded ? "true" : "false"}
                @click=${() => this.toggleRawEventDetails(eventId)}
              >
                ${
                  detailsExpanded
                    ? html`
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      `
                    : html`
                        <svg
                          aria-hidden="true"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="m9 18 6-6-6-6" />
                        </svg>
                      `
                }
                <span
                  >${detailsExpanded ? "Hide details" : "Show details"}</span
                >
              </button>
              ${
                detailsExpanded
                  ? html`<pre class="cpk-td__event-payload">
${unsafeHTML(highlightedJson(event.rawEvent ?? event))}</pre
                  >`
                  : nothing
              }
            </div>
          `;
        })}`;
      },
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
