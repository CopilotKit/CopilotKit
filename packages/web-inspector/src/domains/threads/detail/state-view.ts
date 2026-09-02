import { html } from "lit";
import type { TemplateResult } from "lit";

function coerceJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  const looksJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!looksJson) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function renderThreadJsonValue(
  value: unknown,
  options: {
    maxHeight?: string;
    copyable?: boolean;
    copyLabel?: string;
    clipboard?: Pick<Clipboard, "writeText">;
  } = {},
): TemplateResult {
  return html`<cpk-inspector-json-viewer
    .value=${coerceJsonValue(value)}
    .maxHeight=${options.maxHeight ?? ""}
    .copyable=${options.copyable ?? false}
    .copyLabel=${options.copyLabel ?? "Copy"}
    .clipboard=${options.clipboard}
  ></cpk-inspector-json-viewer>`;
}

export function renderThreadStateView(options: {
  loading: boolean;
  error: string | null;
  notAvailable: boolean;
  state: Record<string, unknown> | null;
}): TemplateResult {
  if (options.loading) {
    return html`
      <div class="cpk-td__status">Loading state…</div>
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
  if (!options.state || Object.keys(options.state).length === 0) {
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
  return renderThreadJsonValue(options.state);
}
