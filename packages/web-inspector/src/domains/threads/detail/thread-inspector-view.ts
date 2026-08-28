import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { ThreadDebuggerMetadata } from "../../../shared/thread-debugger/types.js";
import { renderConversationItems } from "./conversation-view.js";
import type { ApiAgentEvent } from "./event-adapter.js";
import { renderThreadEventsView } from "./events-view.js";
import type {
  ConversationItem,
  ConversationRenderItem,
} from "./message-adapter.js";
import type {
  ThreadActivityCounts,
  ThreadDetailsPanelCacheSlot,
  ThreadDetailsTab,
  ThreadMetadataPill,
} from "./thread-inspector-model.js";
import { renderThreadStateView } from "./state-view.js";
import type { TimelineItem } from "./timeline-model.js";
import { renderTimelineItems } from "./timeline-view.js";

export const THREAD_DETAILS_TABS: ReadonlyArray<{
  id: ThreadDetailsTab;
  label: string;
}> = [
  { id: "timeline", label: "Messages" },
  { id: "raw-events", label: "AG-UI Events" },
  { id: "state", label: "State" },
];

type PanelTemplateCache = {
  get: (
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
  ) => TemplateResult | null;
  create: (
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
    build: () => TemplateResult,
  ) => TemplateResult;
};

export type PanelTemplateCacheEntries = Map<
  ThreadDetailsPanelCacheSlot,
  { key: readonly unknown[]; tpl: TemplateResult }
>;

export function createPanelTemplateCache(
  entries: PanelTemplateCacheEntries,
): PanelTemplateCache {
  const get = (
    slot: ThreadDetailsPanelCacheSlot,
    key: readonly unknown[],
  ): TemplateResult | null => {
    const cached = entries.get(slot);
    if (
      cached &&
      cached.key.length === key.length &&
      cached.key.every((value, index) => value === key[index])
    ) {
      return cached.tpl;
    }
    return null;
  };
  return {
    get,
    create(slot, key, build) {
      const cached = get(slot, key);
      if (cached) return cached;
      const template = build();
      entries.set(slot, { key, tpl: template });
      return template;
    },
  };
}

export function renderThreadInspectorView(options: {
  activeTab: ThreadDetailsTab;
  activatedTabs: Set<ThreadDetailsTab>;
  panelInitializing: boolean;
  showDetailPanel: boolean;
  detailPanelWidth: number;
  tabDomId: (id: ThreadDetailsTab) => string;
  panelDomId: (id: ThreadDetailsTab) => string;
  onActivateTab: (id: ThreadDetailsTab) => void;
  onTabKeyDown: (event: KeyboardEvent, id: ThreadDetailsTab) => void;
  onDetailDividerDown: (event: PointerEvent) => void;
  onDetailDividerMove: (event: PointerEvent) => void;
  onDetailDividerUp: (event: PointerEvent) => void;
  metadataStrip: TemplateResult;
  viewInAppAction: TemplateResult | typeof nothing;
  panelToggle: TemplateResult;
  detailPanel: TemplateResult;
  renderTabContent: (id: ThreadDetailsTab) => TemplateResult;
}): TemplateResult {
  return html`
    <div class="cpk-td">
      <div class="cpk-td__left">
        <div class="cpk-td__tabs-header">
          <div
            class="cpk-td__tab-group"
            role="tablist"
            aria-label="Thread detail views"
          >
            ${THREAD_DETAILS_TABS.map(
              (tab) => html`
                <button
                  id=${options.tabDomId(tab.id)}
                  type="button"
                  role="tab"
                  aria-controls=${options.panelDomId(tab.id)}
                  aria-selected=${
                    options.activeTab === tab.id ? "true" : "false"
                  }
                  tabindex=${options.activeTab === tab.id ? "0" : "-1"}
                  class="cpk-td__tab ${
                    options.activeTab === tab.id ? "cpk-td__tab--active" : ""
                  }"
                  @click=${() => options.onActivateTab(tab.id)}
                  @keydown=${(event: KeyboardEvent) =>
                    options.onTabKeyDown(event, tab.id)}
                >
                  ${tab.label}
                </button>
              `,
            )}
          </div>
          ${
            options.viewInAppAction !== nothing
              ? html`<div class="cpk-td__chrome-actions">
                ${options.viewInAppAction}
              </div>`
              : nothing
          }
          ${options.panelToggle}
        </div>
        ${options.metadataStrip}

        <div class="cpk-td__content">
          ${
            options.panelInitializing
              ? html`
                  <div class="cpk-td__status">Loading…</div>
                `
              : nothing
          }
          ${THREAD_DETAILS_TABS.map((tab) =>
            options.activatedTabs.has(tab.id)
              ? html`<div
                  id=${options.panelDomId(tab.id)}
                  class="cpk-td__panel"
                  role="tabpanel"
                  aria-labelledby=${options.tabDomId(tab.id)}
                  ?hidden=${
                    options.activeTab !== tab.id || options.panelInitializing
                  }
                >
                  ${options.renderTabContent(tab.id)}
                </div>`
              : nothing,
          )}
        </div>
      </div>

      <div
        class="cpk-td__detail"
        data-open=${options.showDetailPanel ? "true" : "false"}
        style="width:${
          options.showDetailPanel ? options.detailPanelWidth : 0
        }px"
        aria-hidden=${options.showDetailPanel ? "false" : "true"}
      >
        ${
          options.showDetailPanel
            ? html`
              <div
                class="cpk-td__detail-divider"
                @pointerdown=${options.onDetailDividerDown}
                @pointermove=${options.onDetailDividerMove}
                @pointerup=${options.onDetailDividerUp}
                @pointercancel=${options.onDetailDividerUp}
              ></div>
            `
            : nothing
        }
        ${options.detailPanel}
      </div>
    </div>
  `;
}

export function renderMetadataStrip(
  pills: ThreadMetadataPill[],
): TemplateResult {
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

export function renderViewInAppAction(options: {
  viewInAppMode: "hidden" | "view" | "stop";
  viewInAppError: string | null;
  dispatchEvent: (event: Event) => boolean;
}): TemplateResult | typeof nothing {
  if (options.viewInAppMode === "hidden") return nothing;
  const isStop = options.viewInAppMode === "stop";
  const action = isStop ? "stopViewing" : "viewInApp";
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
      @click=${() =>
        options.dispatchEvent(
          new CustomEvent(action, { bubbles: true, composed: true }),
        )}
    >
      ${isStop ? "Stop viewing" : "View in your app"}
    </button>
    ${
      options.viewInAppError
        ? html`<span class="cpk-td__view-in-app-error" role="alert"
          >${options.viewInAppError}</span
        >`
        : nothing
    }
  `;
}

export function renderTryFromHereAction(options: {
  tryFromHereAvailable: boolean;
  tryFromHereBusy: boolean;
  tryFromHereError: string | null;
  threadId: string | null;
  dispatchEvent: (event: Event) => boolean;
}): TemplateResult | typeof nothing {
  if (!options.tryFromHereAvailable) return nothing;
  return html`
    <button
      type="button"
      class="cpk-td__try-from-here"
      aria-label=${options.tryFromHereBusy ? "Loading thread" : "Try from here"}
      aria-busy=${options.tryFromHereBusy}
      ?disabled=${options.tryFromHereBusy}
      @click=${() => {
        if (options.tryFromHereBusy) return;
        options.dispatchEvent(
          new CustomEvent("tryFromHere", {
            detail: options.threadId,
            bubbles: true,
            composed: true,
          }),
        );
      }}
    >
      ${options.tryFromHereBusy ? "Loading…" : "Try from here"}
      <svg
        class="cpk-td__try-from-here-icon"
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 7h10v10" />
        <path d="M7 17 17 7" />
      </svg>
    </button>
    ${
      options.tryFromHereError
        ? html`<span class="cpk-td__try-from-here-error" role="alert"
          >${options.tryFromHereError}</span
        >`
        : nothing
    }
  `;
}

export function renderPanelToggle(options: {
  isOpen: boolean;
  onToggle: () => void;
}): TemplateResult {
  return html`
    <button
      class="cpk-td__panel-toggle ${
        options.isOpen ? "cpk-td__panel-toggle--active" : ""
      }"
      @click=${options.onToggle}
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

export function renderDetailPanel(options: {
  metadata: ThreadDebuggerMetadata | null;
  threadId: string | null;
  duration: string;
  counts: ThreadActivityCounts;
  eventCount: number;
  formatTime: (value: string | null | undefined) => string;
}): TemplateResult {
  const { metadata } = options;
  return html`
    <div class="cpk-tdp__section-title">Thread</div>
    <div class="cpk-tdp__row">
      <span class="cpk-tdp__label">ID</span>
      <span class="cpk-tdp__value cpk-tdp__value--wrap"
        >${metadata?.id ?? options.threadId ?? "—"}</span
      >
    </div>
    ${renderDetailRow("Name", metadata?.name)}
    ${renderDetailRow("Agent", metadata?.agentId, true)}
    ${renderDetailRow("End user", metadata?.endUserId, true)}
    ${renderDetailRow("Created by", metadata?.createdById, true)}
    ${renderDetailRow("Status", metadata?.status, true)}

    <div class="cpk-tdp__divider"></div>
    <div class="cpk-tdp__section-title">Timestamps</div>
    ${renderDetailRow("Created", options.formatTime(metadata?.createdAt))}
    ${renderDetailRow("Updated", options.formatTime(metadata?.updatedAt))}
    ${renderDetailRow("Duration", options.duration)}

    <div class="cpk-tdp__divider"></div>
    <div class="cpk-tdp__section-title">Activity</div>
    ${renderDetailRow("Messages", String(options.counts.messages))}
    ${renderDetailRow("Tool calls", String(options.counts.toolCalls))}
    ${renderDetailRow("AG-UI events", String(options.eventCount))}
  `;
}

function renderDetailRow(
  label: string,
  value: string | null | undefined,
  truncate: boolean = false,
): TemplateResult {
  return html`
    <div class="cpk-tdp__row">
      <span class="cpk-tdp__label">${label}</span>
      <span
        class="cpk-tdp__value ${truncate ? "cpk-tdp__value--truncate" : ""}"
        >${value ?? "—"}</span
      >
    </div>
  `;
}

export function renderTimelinePanel(options: {
  loadingEvents: boolean;
  eventsError: string | null;
  eventsNotAvailable: boolean;
  conversation: ConversationItem[];
  loadingMessages: boolean;
  agentMessages: ReadonlyArray<{
    id?: string;
    role: string;
    contentText: string;
  }>;
  expandedDetails: Set<string>;
  getEvents: () => ApiAgentEvent[];
  getTimelineItems: (events: ApiAgentEvent[]) => TimelineItem[];
  renderConversation: () => TemplateResult;
  cache: PanelTemplateCache;
  onToggleDetails: (id: string) => void;
  onRevealSourceEvent: (sourceIndex: number) => void;
}): TemplateResult {
  if (options.loadingEvents) {
    return html`
      <div class="cpk-td__status">Loading timeline…</div>
    `;
  }
  if (options.eventsError) {
    return html`<div class="cpk-td__status cpk-td__status--error">
      ${options.eventsError}
    </div>`;
  }
  if (options.eventsNotAvailable) {
    if (options.conversation.length > 0 || options.loadingMessages) {
      return options.renderConversation();
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

  const events = options.getEvents();
  const cacheKey = [
    events,
    options.conversation,
    options.agentMessages,
    options.expandedDetails,
  ];
  const cachedTimeline = options.cache.get("timeline", cacheKey);
  if (cachedTimeline) return cachedTimeline;
  const items = options.getTimelineItems(events);
  if (items.length === 0) {
    if (options.conversation.length > 0 || options.loadingMessages) {
      return options.renderConversation();
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
  return options.cache.create("timeline", cacheKey, () =>
    renderTimelineItems({
      items,
      expandedDetails: options.expandedDetails,
      onToggleDetails: options.onToggleDetails,
      onRevealSourceEvent: options.onRevealSourceEvent,
    }),
  );
}

export function renderConversationPanel(options: {
  loading: boolean;
  error: string | null;
  conversation: ConversationItem[];
  renderItems: () => ConversationRenderItem[];
  expandedTools: Set<string>;
  expandedMessages: Set<string>;
  collapseThreshold: number;
  cache: PanelTemplateCache;
  onToggleMessage: (id: string) => void;
  onToggleTool: (id: string) => void;
}): TemplateResult {
  if (options.loading) {
    return html`
      <div class="cpk-td__status">Loading messages…</div>
    `;
  }
  if (options.error) {
    return html`<div class="cpk-td__status cpk-td__status--error">
      ${options.error}
    </div>`;
  }
  if (options.conversation.length === 0) {
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
  return options.cache.create(
    "timeline-fallback",
    [options.conversation, options.expandedTools, options.expandedMessages],
    () =>
      renderConversationItems(options.renderItems(), {
        collapseThreshold: options.collapseThreshold,
        expandedMessages: options.expandedMessages,
        expandedTools: options.expandedTools,
        onToggleMessage: options.onToggleMessage,
        onToggleTool: options.onToggleTool,
      }),
  );
}

export function renderStatePanel(options: {
  loading: boolean;
  error: string | null;
  notAvailable: boolean;
  state: Record<string, unknown> | null;
  cache: PanelTemplateCache;
}): TemplateResult {
  if (
    !options.loading &&
    !options.error &&
    !options.notAvailable &&
    options.state &&
    Object.keys(options.state).length > 0
  ) {
    return options.cache.create("state", [options.state], () =>
      renderThreadStateView(options),
    );
  }
  return renderThreadStateView(options);
}

export function renderEventsPanel(options: {
  loading: boolean;
  error: string | null;
  notAvailable: boolean;
  getEvents: () => ApiAgentEvent[];
  expandedEvents: Set<string>;
  cache: PanelTemplateCache;
  onExpandAll: (ids: string[]) => void;
  onCollapseAll: (ids: string[]) => void;
  onToggleDetails: (id: string) => void;
}): TemplateResult {
  if (options.loading) {
    return html`
      <div class="cpk-td__status">Loading events…</div>
    `;
  }
  if (options.error) {
    return html`<div class="cpk-td__status cpk-td__status--error">
      ${options.error}
    </div>`;
  }
  if (options.notAvailable) {
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
  const events = options.getEvents();
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
  return options.cache.create(
    "raw-events",
    [events, options.expandedEvents],
    () =>
      renderThreadEventsView({
        events,
        expandedEvents: options.expandedEvents,
        onExpandAll: options.onExpandAll,
        onCollapseAll: options.onCollapseAll,
        onToggleDetails: options.onToggleDetails,
      }),
  );
}
