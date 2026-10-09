import { html, nothing } from "lit";
import type { InspectorToolDefinition, LiveInspectionState } from "../state.js";
import { liveInspectionPanelId } from "../state.js";
import { extractSchemaInfo } from "./model.js";

export type ToolsViewModel = Readonly<{
  state: LiveInspectionState;
  tools: InspectorToolDefinition[];
  available: boolean;
  renderIcon: (name: string) => unknown;
  onToggle: (id: string) => void;
}>;

export function renderToolsView(model: ToolsViewModel) {
  if (!model.available) {
    return html`
      <div
        class="flex h-full items-center justify-center px-4 py-8 text-xs text-gray-500"
      >
        No core instance available
      </div>
    `;
  }
  if (model.tools.length === 0) {
    return html`<div
      class="flex h-full items-center justify-center px-4 py-8 text-center"
    >
      <div class="max-w-md">
        <div
          class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
        >
          ${model.renderIcon("Hammer")}
        </div>
        <p class="text-sm text-gray-600">No tools available</p>
        <p class="mt-2 text-xs text-gray-500">
          Tools will appear here once agents are configured with tool handlers or
          renderers.
        </p>
      </div>
    </div>`;
  }
  return html`<div class="flex h-full flex-col overflow-hidden">
    <div class="overflow-auto p-4">
      <div class="space-y-3">
        ${model.tools.map((tool) => renderToolCard(tool, model))}
      </div>
    </div>
  </div>`;
}

export function renderAgentToolsSection(model: ToolsViewModel) {
  return html`<div class="cpk-section-card">
    <div class="cpk-section-header"><h4>Registered Tools</h4></div>
    <div class="overflow-auto p-4">
      ${
        model.tools.length > 0
          ? html`<div class="space-y-3">
            ${model.tools.map((tool) => renderToolCard(tool, model))}
          </div>`
          : html`<div
            class="flex h-12 items-center justify-center text-xs text-gray-500"
          >
            <div class="flex items-center gap-2 text-gray-500">
              <span aria-hidden="true" class="text-lg text-gray-400"
                >${model.renderIcon("Hammer")}</span
              >
              <span>No tools registered</span>
            </div>
          </div>`
      }
    </div>
  </div>`;
}

function renderToolCard(tool: InspectorToolDefinition, model: ToolsViewModel) {
  const id = `${tool.agentId}:${tool.name}`;
  const panelId = liveInspectionPanelId("tool", id);
  const expanded = model.state.expandedToolIds.has(id);
  const properties = extractSchemaInfo(tool.parameters);
  const typeClasses =
    tool.type === "handler"
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : "bg-purple-50 text-purple-700 border-purple-200";
  return html`<section
    class="rounded-lg border border-gray-200 bg-white overflow-hidden"
  >
    <button
      type="button"
      class="live-inspection-control w-full px-4 py-3 text-left transition hover:bg-gray-50"
      aria-expanded=${expanded ? "true" : "false"}
      aria-controls=${panelId}
      aria-label="${expanded ? "Collapse" : "Expand"} tool ${tool.name}"
      @click=${() => model.onToggle(id)}
    >
      <span class="flex items-start justify-between gap-3">
        <span class="flex-1 min-w-0">
          <span class="flex items-center gap-2 mb-1">
            <span class="font-mono text-sm font-semibold text-gray-900"
              >${tool.name}</span
            >
            <span
              class="inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-medium ${typeClasses}"
              >${tool.type}</span
            >
          </span>
          <span class="flex items-center gap-2 text-xs text-gray-500">
            <span class="flex items-center gap-1">
              ${model.renderIcon("Bot")} <span class="font-mono">${tool.agentId}</span>
            </span>
            ${
              properties.length > 0
                ? html`<span aria-hidden="true" class="text-gray-300">•</span>
                  <span
                    >${properties.length} parameter${
                      properties.length === 1 ? "" : "s"
                    }</span
                  >`
                : nothing
            }
          </span>
          ${
            tool.description
              ? html`<span class="block mt-2 text-xs text-gray-600"
                >${tool.description}</span
              >`
              : nothing
          }
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
        ? html`<div
          id=${panelId}
          class="border-t border-gray-200 bg-gray-50/50 px-4 py-3"
        >
          ${
            properties.length > 0
              ? html`<h5 class="mb-3 text-xs font-semibold text-gray-700">
                    Parameters
                  </h5>
                  <div class="space-y-3">
                    ${properties.map(
                      (property) => html`<div
                        class="rounded-md border border-gray-200 bg-white p-3"
                      >
                        <div class="flex items-start justify-between gap-2 mb-1">
                          <span
                            class="font-mono text-xs font-medium text-gray-900"
                            >${property.name}</span
                          >
                          <div class="flex items-center gap-1.5 shrink-0">
                            <span
                              class="text-[9px] rounded border px-1 py-0.5 font-medium ${
                                property.required
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-gray-200 bg-gray-50 text-gray-600"
                              }"
                              >${property.required ? "required" : "optional"}</span
                            >
                            ${
                              property.type
                                ? html`<span
                                  class="text-[9px] rounded border border-gray-200 bg-gray-50 px-1 py-0.5 font-mono text-gray-600"
                                  >${property.type}</span
                                >`
                                : nothing
                            }
                          </div>
                        </div>
                        ${
                          property.description
                            ? html`<p class="mt-1 text-xs text-gray-600">
                              ${property.description}
                            </p>`
                            : nothing
                        }
                        ${
                          property.defaultValue !== undefined
                            ? html`<div
                              class="mt-2 flex items-center gap-1.5 text-[10px] text-gray-500"
                            >
                              <span>Default:</span>
                              <code class="rounded bg-gray-100 px-1 py-0.5 font-mono"
                                >${JSON.stringify(property.defaultValue)}</code
                              >
                            </div>`
                            : nothing
                        }
                        ${
                          property.enum?.length
                            ? html`<div class="mt-2">
                              <span class="text-[10px] text-gray-500"
                                >Allowed values:</span
                              >
                              <div class="mt-1 flex flex-wrap gap-1">
                                ${property.enum.map(
                                  (value) => html`<code
                                    class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-mono text-gray-700"
                                    >${JSON.stringify(value)}</code
                                  >`,
                                )}
                              </div>
                            </div>`
                            : nothing
                        }
                      </div>`,
                    )}
                  </div>`
              : html`
                  <div class="flex items-center justify-center py-4 text-xs text-gray-500">
                    No parameters defined
                  </div>
                `
          }
        </div>`
        : nothing
    }
  </section>`;
}
