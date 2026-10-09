import { html, nothing } from "lit";
import type { CapabilityToolRow } from "./model.js";

export type CapabilitiesViewModel = Readonly<{
  available: boolean;
  tools: CapabilityToolRow[];
  catalog: CapabilityToolRow[];
  renderIcon: (name: string) => unknown;
  onToggleTool: (row: CapabilityToolRow) => void;
  onToggleCatalog: (row: CapabilityToolRow) => void;
}>;

export function renderCapabilitiesView(model: CapabilitiesViewModel) {
  if (!model.available) {
    return html`
      <div
        class="flex h-full items-center justify-center px-4 py-8 text-xs text-gray-500"
      >
        No core instance available
      </div>
    `;
  }
  if (model.tools.length === 0 && model.catalog.length === 0) {
    return html`<div
      class="flex h-full items-center justify-center px-4 py-8 text-center"
    >
      <div class="max-w-md">
        <div
          class="mb-3 flex justify-center text-gray-300 [&>svg]:!h-8 [&>svg]:!w-8"
        >
          ${model.renderIcon("SlidersHorizontal")}
        </div>
        <p class="text-sm text-gray-600">No capabilities registered</p>
        <p class="mt-2 text-xs text-gray-500">
          Frontend tools and A2UI catalog components will appear here once they
          are registered on the CopilotKit core.
        </p>
      </div>
    </div>`;
  }
  return html`<div class="flex h-full flex-col overflow-hidden">
    <div class="overflow-auto p-4">
      <p class="text-xs text-gray-500">
        Toggle a capability off to omit it from what the agent sees. This is a
        client-side experimentation surface and takes effect immediately.
      </p>
      ${renderSection("Frontend tools", model.tools, model, model.onToggleTool)}
      ${renderSection(
        "A2UI catalog components",
        model.catalog,
        model,
        model.onToggleCatalog,
      )}
    </div>
  </div>`;
}

function renderSection(
  heading: string,
  rows: CapabilityToolRow[],
  model: CapabilitiesViewModel,
  onToggle: (row: CapabilityToolRow) => void,
) {
  if (rows.length === 0) return nothing;
  return html`<section class="mt-4 space-y-2">
    <h3 class="text-sm text-slate-500">${heading}</h3>
    <div class="space-y-2">
      ${rows.map((row) => renderCapabilityRow(row, model, onToggle))}
    </div>
  </section>`;
}

function renderCapabilityRow(
  row: CapabilityToolRow,
  model: CapabilitiesViewModel,
  onToggle: (row: CapabilityToolRow) => void,
) {
  const accessibleName = row.agentId
    ? `Toggle ${row.name} capability for agent ${row.agentId}`
    : `Toggle ${row.name} capability`;
  return html`<div
    class="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3"
  >
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <span class="font-mono text-sm font-semibold text-gray-900"
          >${row.name}</span
        >
        ${
          row.agentId
            ? html`<span
              class="inline-flex items-center gap-1 text-xs text-gray-500"
            >
              ${model.renderIcon("Bot")}<span class="font-mono"
                >${row.agentId}</span
              >
            </span>`
            : nothing
        }
      </div>
      ${
        row.description
          ? html`<p class="mt-1 text-xs text-gray-600">${row.description}</p>`
          : nothing
      }
    </div>
    <button
      type="button"
      role="switch"
      aria-label=${accessibleName}
      aria-checked=${row.enabled ? "true" : "false"}
      class="live-inspection-control relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        row.enabled ? "bg-emerald-500" : "bg-gray-300"
      }"
      @click=${() => onToggle(row)}
    >
      <span
        aria-hidden="true"
        class="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          row.enabled ? "translate-x-4" : "translate-x-0.5"
        }"
      ></span>
    </button>
  </div>`;
}
