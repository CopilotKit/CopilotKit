import { html, nothing } from "lit";
import type { InspectorEvent, LiveInspectionState } from "../state.js";
import { AGENT_EVENT_TYPES, liveInspectionPanelId } from "../state.js";
import {
  eventBadgeClasses,
  extractEventFromPayload,
  filterEvents,
  stringifyEventPayload,
} from "./model.js";

export type EventsViewModel = Readonly<{
  state: LiveInspectionState;
  events: InspectorEvent[];
  embedded?: boolean;
  failedRunEventId?: string;
  clipboard?: Pick<Clipboard, "writeText">;
  renderIcon: (name: string) => unknown;
  renderJson: (
    value: unknown,
    options?: {
      maxHeight?: string;
      copyable?: boolean;
      copyLabel?: string;
      clipboard?: Pick<Clipboard, "writeText">;
    },
  ) => unknown;
  onFilterInput: (event: Event) => void;
  onAgentChange: (event: Event) => void;
  onTypeChange: (event: Event) => void;
  onResetFilters: () => void;
  onExport: (events: InspectorEvent[]) => void;
  onClear: () => void;
  onToggle: (eventId: string, event: Event) => void;
  onResizeStart: (event: PointerEvent, column: number) => void;
  onResizeMove: (event: PointerEvent) => void;
  onResizeEnd: () => void;
  onResizeKeyDown: (event: KeyboardEvent, column: number) => void;
}>;

export function renderEventsView(model: EventsViewModel) {
  const { state, events } = model;
  const filteredEvents = filterEvents(
    events,
    state.eventFilterText,
    state.eventTypeFilter,
  );
  const embedded = model.embedded === true;
  const selectedLabel =
    state.selectedContext === "all-agents"
      ? "all agents"
      : `agent ${state.selectedContext}`;

  let body;
  if (events.length === 0) {
    body = html`<div
      class="flex h-full flex-col items-center justify-center gap-2 px-4 py-10 text-center"
    >
      <div class="text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8">
        ${model.renderIcon("Zap")}
      </div>
      <span class="text-sm text-gray-600">No events yet</span>
      <span class="max-w-[240px] text-xs leading-snug text-gray-400"
        >Events are recorded live. Run the agent to see them here.</span
      >
    </div>`;
  } else if (filteredEvents.length === 0) {
    body = html`<div
      class="flex h-full items-center justify-center px-4 py-8 text-center"
    >
      <div class="max-w-md space-y-3">
        <div
          class="flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
        >
          ${model.renderIcon("Filter")}
        </div>
        <p class="text-sm text-gray-600">No events match the current filters.</p>
        <button
          type="button"
          class="live-inspection-control inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-medium text-white transition hover:bg-gray-800"
          @click=${model.onResetFilters}
        >
          ${model.renderIcon("RefreshCw")} <span>Reset filters</span>
        </button>
      </div>
    </div>`;
  } else {
    body = html`<div class="relative h-full w-full overflow-y-auto overflow-x-hidden">
      <table class="w-full table-fixed border-collapse text-xs box-border">
        <caption class="sr-only">Live AG-UI events</caption>
        <colgroup>
          <col style="width:${state.eventColumnWidths[0]}px" />
          <col style="width:${state.eventColumnWidths[1]}px" />
          <col style="width:${state.eventColumnWidths[2]}px" />
          <col />
        </colgroup>
        <thead class="sticky top-0 z-10">
          <tr class="bg-white">
            ${["Agent", "Time", "Event Type"].map(
              (label, column) => html`<th
                scope="col"
                class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
                style="position:relative;overflow:visible;"
              >
                ${label}
                <div
                  role="separator"
                  tabindex="0"
                  class="event-column-resizer live-inspection-control"
                  aria-label="Resize ${label} column"
                  aria-orientation="vertical"
                  aria-valuemin="40"
                  aria-valuemax=${Math.max(
                    4_096,
                    state.eventColumnWidths[column] ?? 40,
                  )}
                  aria-valuenow=${state.eventColumnWidths[column] ?? 40}
                  @pointerdown=${(event: PointerEvent) =>
                    model.onResizeStart(event, column)}
                  @pointermove=${model.onResizeMove}
                  @pointerup=${model.onResizeEnd}
                  @pointercancel=${model.onResizeEnd}
                  @keydown=${(event: KeyboardEvent) =>
                    model.onResizeKeyDown(event, column)}
                ></div>
              </th>`,
            )}
            <th
              scope="col"
              class="border-b border-gray-200 bg-white px-3 py-2 text-left font-medium text-gray-900"
            >
              AG-UI Event
            </th>
          </tr>
        </thead>
        <tbody>
          ${filteredEvents.map((event, index) => {
            const isFailed = event.id === model.failedRunEventId;
            const expanded = state.expandedEventIds.has(event.id);
            const panelId = liveInspectionPanelId("event", event.id);
            const extracted = extractEventFromPayload(event.payload);
            const inline = stringifyEventPayload(extracted) || "—";
            const rowBackground = isFailed
              ? "bg-rose-50"
              : index % 2 === 0
                ? "bg-white"
                : "bg-gray-50/50";
            return html`<tr
              class="${rowBackground} transition hover:bg-blue-50/50"
              data-inspector-event-id=${event.id}
              data-cpk-failed-run-event=${isFailed ? event.id : undefined}
            >
              <td class="border-l border-r border-b border-gray-200 px-3 py-2">
                <span class="font-mono text-[11px] text-gray-600"
                  >${event.agentId}</span
                >
              </td>
              <td
                class="border-r border-b border-gray-200 px-3 py-2 font-mono text-[11px] text-gray-600"
              >
                <span title=${new Date(event.timestamp).toLocaleString()}
                  >${new Date(event.timestamp).toLocaleTimeString()}</span
                >
              </td>
              <td class="border-r border-b border-gray-200 px-3 py-2">
                <span class=${eventBadgeClasses(event.type)}>${event.type}</span>
              </td>
              <td
                class="border-r border-b border-gray-200 p-0 font-mono text-[10px] text-gray-600"
              >
                ${
                  expanded
                    ? html`<div class="event-expanded-payload" id=${panelId}>
                      <button
                        type="button"
                        class="event-collapse-button live-inspection-control"
                        aria-expanded="true"
                        aria-controls=${panelId}
                        aria-label="Collapse ${event.type} event from ${event.agentId}"
                        @click=${(clickEvent: Event) =>
                          model.onToggle(event.id, clickEvent)}
                      >
                        Collapse details
                      </button>
                      ${model.renderJson(extracted, {
                        copyable: true,
                        clipboard: model.clipboard,
                      })}
                    </div>`
                    : html`<button
                      type="button"
                      class="event-expansion-button live-inspection-control truncate"
                      aria-expanded="false"
                      aria-controls=${panelId}
                      aria-label="Expand ${event.type} event from ${event.agentId}"
                      @click=${(clickEvent: Event) =>
                        model.onToggle(event.id, clickEvent)}
                    >
                      ${inline}
                    </button>`
                }
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
    </div>`;
  }

  return html`<div
    class=${
      embedded
        ? "flex h-[28rem] min-h-[20rem] flex-col"
        : "flex h-full flex-col"
    }
  >
    <div
      class="flex flex-col gap-1.5 border-b border-gray-200 bg-white px-4 py-2.5"
    >
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-[200px] flex-1">
          <input
            type="search"
            aria-label="Search events"
            class="live-inspection-control w-full rounded-md border border-gray-200 px-3 py-1.5 text-[11px] text-gray-700 shadow-sm ring-1 ring-transparent transition focus:border-gray-300 focus:ring-gray-200"
            placeholder="Search agent, type, payload"
            .value=${state.eventFilterText}
            @input=${model.onFilterInput}
          />
        </div>
        ${
          embedded
            ? nothing
            : html`<select
              class="live-inspection-control w-40 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-sm transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
              .value=${state.selectedContext}
              @change=${model.onAgentChange}
              aria-label="Filter events by agent"
            >
              ${state.contextOptions.map(
                (option) =>
                  html`<option value=${option.key}>${option.label}</option>`,
              )}
            </select>`
        }
        <select
          class="live-inspection-control w-40 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-700 shadow-sm transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          .value=${state.eventTypeFilter}
          @change=${model.onTypeChange}
          aria-label="Filter events by type"
        >
          <option value="all">All event types</option>
          ${AGENT_EVENT_TYPES.map(
            (type) => html`<option value=${type}
              >${type.toLowerCase().replace(/_/g, " ")}</option
            >`,
          )}
        </select>
        <div class="flex items-center gap-1 text-[11px]">
          ${renderToolbarButton(
            "Reset filters",
            "RotateCw",
            model,
            model.onResetFilters,
            !state.eventFilterText && state.eventTypeFilter === "all",
          )}
          ${renderToolbarButton(
            "Export JSON",
            "Download",
            model,
            () => model.onExport(filteredEvents),
            filteredEvents.length === 0,
          )}
          ${renderToolbarButton(
            "Clear events",
            "Trash2",
            model,
            model.onClear,
            events.length === 0,
          )}
        </div>
      </div>
      <div class="text-[11px] text-gray-500">
        Showing ${filteredEvents.length} of ${events.length}${
          state.selectedContext === "all-agents" ? "" : ` for ${selectedLabel}`
        }
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">${body}</div>
  </div>`;
}

function renderToolbarButton(
  label: string,
  icon: string,
  model: EventsViewModel,
  onClick: () => void,
  disabled: boolean,
) {
  return html`<button
    type="button"
    class="tooltip-target live-inspection-control flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
    title=${label}
    data-tooltip=${label}
    aria-label=${label}
    @click=${onClick}
    ?disabled=${disabled}
  >
    ${model.renderIcon(icon)}
  </button>`;
}
