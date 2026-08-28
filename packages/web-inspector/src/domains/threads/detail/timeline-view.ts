import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { formatTimestamp } from "./event-adapter.js";
import { renderThreadJsonValue } from "./state-view.js";
import type { TimelineItem } from "./timeline-model.js";

function timelineItemClass(item: TimelineItem): string {
  const classes = [
    "cpk-td__timeline-item",
    `cpk-td__timeline-item--${item.kind}`,
  ];
  if (item.kind === "warning" || item.severity === "error") {
    classes.push("cpk-td__timeline-item--warning");
  }
  if (item.kind === "message") {
    const title = item.title.toLowerCase();
    if (title.startsWith("user")) {
      classes.push("cpk-td__timeline-item--user");
    } else if (title.includes("assistant")) {
      classes.push("cpk-td__timeline-item--assistant");
    }
  }
  return classes.join(" ");
}

export function renderTimelineItems(options: {
  items: TimelineItem[];
  expandedDetails: Set<string>;
  onToggleDetails: (id: string) => void;
  onRevealSourceEvent: (sourceIndex: number) => void;
}): TemplateResult {
  return html`${options.items.map((item) => {
    const detailsExpanded = options.expandedDetails.has(item.id);
    return html`
      <div
        class=${timelineItemClass(item)}
        data-message-id=${item.messageId ?? nothing}
      >
        <div class="cpk-td__timeline-header">
          <span class="cpk-td__timeline-kind"
            >${item.severity === "error" ? "error" : item.kind}</span
          >
          <span class="cpk-td__timeline-title">${item.title}</span>
          ${
            item.sourceIndex
              ? html`
                <button
                  type="button"
                  class="cpk-td__source-link"
                  @click=${() => options.onRevealSourceEvent(item.sourceIndex)}
                >
                  Source event #${item.sourceIndex}
                </button>
              `
              : nothing
          }
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
              @click=${() => options.onToggleDetails(item.id)}
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
            ? renderThreadJsonValue(item.details)
            : nothing
        }
      </div>
    `;
  })}`;
}

export function renderTimelineToolbar(options: {
  items: TimelineItem[];
  expandedDetails: Set<string>;
  action: TemplateResult | typeof nothing;
  onExpandAll: (ids: string[]) => void;
  onCollapseAll: (ids: string[]) => void;
}) {
  const detailIds = options.items
    .filter((item) => item.details)
    .map((item) => item.id);
  const showBulkActions = detailIds.length > 1;
  if (!showBulkActions && options.action === nothing) return nothing;
  const allExpanded = detailIds.every((id) => options.expandedDetails.has(id));
  const allCollapsed = detailIds.every(
    (id) => !options.expandedDetails.has(id),
  );

  return html`<div class="cpk-td__timeline-toolbar">
    ${
      showBulkActions
        ? html`
          <button
            type="button"
            class="cpk-td__timeline-bulk-toggle"
            ?disabled=${allExpanded}
            @click=${() => options.onExpandAll(detailIds)}
          >
            Expand all
          </button>
          <button
            type="button"
            class="cpk-td__timeline-bulk-toggle"
            ?disabled=${allCollapsed}
            @click=${() => options.onCollapseAll(detailIds)}
          >
            Collapse all
          </button>
        `
        : nothing
    }
    ${options.action}
  </div>`;
}
