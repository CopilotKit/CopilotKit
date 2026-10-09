import { html, nothing } from "lit";
import type { InspectorContextEntry, LiveInspectionState } from "../state.js";
import { liveInspectionPanelId } from "../state.js";
import { contextValuePreview, formatContextValue } from "./model.js";

export type ContextViewModel = Readonly<{
  state: LiveInspectionState;
  clipboard?: Pick<Clipboard, "writeText">;
  renderIcon: (name: string) => unknown;
  renderJson: (value: unknown, options?: { maxHeight?: string }) => unknown;
  onToggle: (id: string) => void;
}>;

export function renderContextView(model: ContextViewModel) {
  const entries = Object.entries(model.state.contextStore);
  if (entries.length === 0) {
    return html`<div
      class="flex h-full items-center justify-center px-4 py-8 text-center"
    >
      <div class="max-w-md">
        <div
          class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
        >
          ${model.renderIcon("FileText")}
        </div>
        <p class="text-sm text-gray-600">No context available</p>
        <p class="mt-2 text-xs text-gray-500">
          Context will appear here once added to CopilotKit.
        </p>
      </div>
    </div>`;
  }
  return html`<div class="flex h-full flex-col overflow-hidden">
    <div class="overflow-auto p-4">
      <div class="space-y-3">
        ${entries.map(([id, context]) => renderContextCard(id, context, model))}
      </div>
    </div>
  </div>`;
}

function renderContextCard(
  id: string,
  context: InspectorContextEntry,
  model: ContextViewModel,
) {
  const expanded = model.state.expandedContextIds.has(id);
  const panelId = liveInspectionPanelId("context", id);
  const hasValue = context.value !== undefined && context.value !== null;
  const title = context.description?.trim() || id;
  return html`<section
    class="rounded-lg border border-gray-200 bg-white overflow-hidden"
  >
    <button
      type="button"
      class="live-inspection-control w-full px-4 py-3 text-left transition hover:bg-gray-50"
      aria-expanded=${expanded ? "true" : "false"}
      aria-controls=${panelId}
      aria-label="${expanded ? "Collapse" : "Expand"} context ${title}"
      @click=${() => model.onToggle(id)}
    >
      <span class="flex items-start justify-between gap-3">
        <span class="flex-1 min-w-0">
          <span class="block text-sm font-medium text-gray-900 mb-1">${title}</span>
          <span class="flex items-center gap-2 text-xs text-gray-500">
            <span
              class="font-mono truncate inline-block align-middle"
              style="max-width: 180px;"
              >${id}</span
            >
            ${
              hasValue
                ? html`<span aria-hidden="true" class="text-gray-300">•</span>
                  <span class="truncate">${contextValuePreview(context.value)}</span>`
                : nothing
            }
          </span>
        </span>
        <span
          aria-hidden="true"
          class="shrink-0 text-gray-400 transition ${
            expanded ? "rotate-180" : ""
          }"
          >${model.renderIcon("ChevronDown")}</span
        >
      </span>
    </button>
    ${
      expanded
        ? html`<div id=${panelId} class="border-t border-gray-200 px-4 py-3">
          <div class="mb-3">
            <div class="mb-1 flex items-center justify-between gap-2">
              <h5 class="text-xs font-semibold text-gray-700">ID</h5>
              <cpk-inspector-copy-button
                class="cpk-copy-btn"
                .value=${id}
                .clipboard=${model.clipboard}
                .resetDelayMs=${1_500}
              ></cpk-inspector-copy-button>
            </div>
            <code
              class="block min-w-0 truncate font-mono text-xs font-medium text-gray-800"
              >${id}</code
            >
          </div>
          ${
            hasValue
              ? html`<div class="mb-2 flex items-center justify-between gap-2">
                  <h5 class="text-xs font-semibold text-gray-700">Value</h5>
                  <cpk-inspector-copy-button
                    class="cpk-copy-btn"
                    label="Copy JSON"
                    .value=${formatContextValue(context.value)}
                    .clipboard=${model.clipboard}
                    .resetDelayMs=${1_500}
                  ></cpk-inspector-copy-button>
                </div>
                ${model.renderJson(context.value, { maxHeight: "180px" })}`
              : html`
                  <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                    No value available
                  </div>
                `
          }
        </div>`
        : nothing
    }
  </section>`;
}
