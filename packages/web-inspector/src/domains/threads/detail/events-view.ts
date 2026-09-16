import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import {
  eventCategory,
  formatTimestamp,
  humanizeEventType,
} from "./event-adapter.js";
import type { ApiAgentEvent } from "./event-adapter.js";
import { renderThreadJsonValue } from "./state-view.js";

export function rawEventId(event: ApiAgentEvent): string {
  return `raw-event-${event.sourceIndex ?? event.timestamp ?? event.type}`;
}

export function renderThreadEventsView(options: {
  events: ApiAgentEvent[];
  expandedEvents: Set<string>;
  onExpandAll: (ids: string[]) => void;
  onCollapseAll: (ids: string[]) => void;
  onToggleDetails: (id: string) => void;
}): TemplateResult {
  const eventIds = options.events.map(rawEventId);
  const allExpanded = eventIds.every((id) => options.expandedEvents.has(id));
  const allCollapsed = eventIds.every((id) => !options.expandedEvents.has(id));
  const controls =
    eventIds.length > 1
      ? html`<div class="cpk-td__timeline-toolbar">
          <button
            type="button"
            class="cpk-td__timeline-bulk-toggle"
            ?disabled=${allExpanded}
            @click=${() => options.onExpandAll(eventIds)}
          >
            Expand all
          </button>
          <button
            type="button"
            class="cpk-td__timeline-bulk-toggle"
            ?disabled=${allCollapsed}
            @click=${() => options.onCollapseAll(eventIds)}
          >
            Collapse all
          </button>
        </div>`
      : nothing;

  return html`${controls}${options.events.map((event) => {
    const eventId = rawEventId(event);
    const detailsExpanded = options.expandedEvents.has(eventId);
    return html`
      <div
        class="cpk-td__event cpk-td__event--${eventCategory(event.type)}"
        data-source-index=${event.sourceIndex}
      >
        <div class="cpk-td__event-header">
          <span class="cpk-td__event-type" title=${event.type}
            >${humanizeEventType(event.type)}</span
          >
          <span class="cpk-td__event-time"
            >${formatTimestamp(event.timestamp)}</span
          >
        </div>
        <button
          type="button"
          class="cpk-td__timeline-details-toggle"
          aria-expanded=${detailsExpanded ? "true" : "false"}
          @click=${() => options.onToggleDetails(eventId)}
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
        </button>
        ${
          detailsExpanded
            ? renderThreadJsonValue(event.rawEvent ?? event)
            : nothing
        }
      </div>
    `;
  })}`;
}
