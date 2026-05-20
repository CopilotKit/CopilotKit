"use client";
/**
 * CellDrilldown — popover panel showing per-badge dimension detail for a
 * single (integration, feature) cell.
 *
 * Renders all badge dimensions (d2/API, d5/CV, e2e/RT, health, smoke) with
 * tone, label, and — for red/amber badges — failure metadata presented as
 * readable key-value pairs with the full signal collapsible for debugging.
 */
import { useState } from "react";
import { resolveCell } from "@/lib/live-status";
import type {
  CellState,
  BadgeRender,
  LiveStatusMap,
  ConnectionStatus,
} from "@/lib/live-status";
import { formatTs } from "@/lib/format-ts";
import { TONE_CLASS, DOT_BG } from "./badges";

export interface CellDrilldownProps {
  slug: string;
  featureId: string;
  integrationName: string;
  featureName: string;
  liveStatus: LiveStatusMap;
  connection?: ConnectionStatus;
  onClose: () => void;
}

/** Dimension metadata for display ordering. */
const DIMENSIONS: Array<{
  key: keyof Omit<CellState, "rollup">;
  label: string;
}> = [
  { key: "d5", label: "CV (Conversation)" },
  { key: "e2e", label: "RT (Round Trip)" },
  { key: "d2", label: "API (Agent)" },
  { key: "health", label: "Health" },
  { key: "smoke", label: "Smoke" },
];

function formatTimestamp(ts: string | null): string {
  if (!ts) return "n/a";
  return formatTs(ts);
}

/**
 * Keys we extract from the signal object and display as readable
 * key-value pairs rather than raw JSON. Ordered by display priority.
 */
const SIGNAL_DISPLAY_KEYS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "errorDesc", label: "Error" },
  { key: "error", label: "Error" },
  { key: "failureSummary", label: "Failure" },
  { key: "backendUrl", label: "Backend URL" },
  { key: "apiRequestCount", label: "API Requests" },
  { key: "step", label: "Step" },
];

/**
 * Extract human-readable fields from a signal object. Returns an array
 * of { label, value } pairs for display. Deduplicates the "Error" label
 * so that `errorDesc` and `error` don't both render when present.
 */
function extractSignalFields(
  signal: unknown,
): Array<{ label: string; value: string }> {
  if (signal == null || typeof signal !== "object" || Array.isArray(signal))
    return [];
  const obj = signal as Record<string, unknown>;
  const fields: Array<{ label: string; value: string }> = [];
  const usedLabels = new Set<string>();
  for (const { key, label } of SIGNAL_DISPLAY_KEYS) {
    if (usedLabels.has(label)) continue;
    const val = obj[key];
    if (val == null) continue;
    const str = typeof val === "string" ? val : String(val);
    if (str.length === 0) continue;
    fields.push({ label, value: str });
    usedLabels.add(label);
  }
  return fields;
}

function formatSignal(signal: unknown): string | null {
  if (signal == null) return null;
  if (typeof signal === "string") return signal || null;
  if (typeof signal === "object") {
    if (Array.isArray(signal) && signal.length === 0) return null;
    if (!Array.isArray(signal) && Object.keys(signal as object).length === 0)
      return null;
    try {
      return JSON.stringify(signal, null, 2);
    } catch {
      return null;
    }
  }
  return String(signal) || null;
}

function CollapsibleSignal({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        data-testid="signal-toggle"
        onClick={() => setOpen(!open)}
        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer flex items-center gap-1"
      >
        <span className="text-[9px]">{open ? "▼" : "▶"}</span>
        Raw Signal
      </button>
      {open && (
        <pre
          data-testid="signal-payload"
          className="mt-1 p-2 rounded bg-[var(--bg-muted)] text-[10px] text-[var(--text)] overflow-x-auto max-h-40 whitespace-pre-wrap break-all"
        >
          {text}
        </pre>
      )}
    </div>
  );
}

function BadgeRow({ badge, label }: { badge: BadgeRender; label: string }) {
  const isFailure = badge.tone === "red" || badge.tone === "amber";
  const signalText = badge.row ? formatSignal(badge.row.signal) : null;
  const signalFields = badge.row ? extractSignalFields(badge.row.signal) : [];

  return (
    <div
      data-testid={`drilldown-badge-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
      className="py-2 border-b border-[var(--border)] last:border-b-0"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${DOT_BG[badge.tone]}`}
          />
          <span className="text-xs font-medium text-[var(--text)]">
            {label}
          </span>
        </div>
        {badge.label === "?" ? (
          <span className="text-xs text-[var(--text-muted)] line-through">
            n/a
          </span>
        ) : (
          <span
            className={`text-xs font-semibold tabular-nums ${TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      {isFailure && badge.row && (
        <div className="mt-1.5 pl-4 space-y-1">
          {/* Extracted signal fields — readable key-value pairs */}
          {signalFields.length > 0 && (
            <div className="space-y-0.5">
              {signalFields.map(({ label: fieldLabel, value }) => (
                <div key={fieldLabel} className="text-xs">
                  <span className="text-[var(--text-muted)]">
                    {fieldLabel}:
                  </span>{" "}
                  <span
                    data-testid={`signal-field-${fieldLabel.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`font-medium ${badge.tone === "red" ? "text-[var(--danger)]" : "text-[var(--amber)]"}`}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
            {badge.row.fail_count > 0 && (
              <span>
                Failures:{" "}
                <span
                  data-testid="fail-count"
                  className="text-[var(--danger)] font-semibold tabular-nums"
                >
                  {badge.row.fail_count}
                </span>
              </span>
            )}
            {badge.row.first_failure_at && (
              <span>
                Since{" "}
                <span
                  data-testid="first-failure"
                  className="text-[var(--text)]"
                >
                  {formatTimestamp(badge.row.first_failure_at)}
                </span>
              </span>
            )}
          </div>
          {/* Raw signal — collapsible for debugging */}
          {signalText && <CollapsibleSignal text={signalText} />}
        </div>
      )}
    </div>
  );
}

export function CellDrilldown({
  slug,
  featureId,
  integrationName,
  featureName,
  liveStatus,
  connection = "live",
  onClose,
}: CellDrilldownProps) {
  const cell = resolveCell(liveStatus, slug, featureId, { connection });

  return (
    <div
      data-testid="cell-drilldown"
      className="absolute z-50 mt-1 w-[480px] rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
      role="dialog"
      aria-label={`${integrationName} / ${featureName} detail`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-muted)] rounded-t-lg">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text)] truncate">
            {integrationName}
          </div>
          <div className="text-xs text-[var(--text-muted)] truncate">
            {featureName}
          </div>
        </div>
        <button
          type="button"
          data-testid="drilldown-close"
          onClick={onClose}
          className="ml-2 p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] text-sm leading-none cursor-pointer"
          aria-label="Close"
        >
          x
        </button>
      </div>
      {/* Rollup */}
      <div className="px-4 py-2 flex items-center gap-2 border-b border-[var(--border)]">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
          Rollup
        </span>
        <span
          className={`inline-block w-2 h-2 rounded-full ${DOT_BG[cell.rollup]}`}
        />
        <span className={`text-xs font-semibold ${TONE_CLASS[cell.rollup]}`}>
          {cell.rollup}
        </span>
      </div>
      {/* Badge rows */}
      <div className="px-4 py-1">
        {DIMENSIONS.map((dim) => (
          <BadgeRow key={dim.key} badge={cell[dim.key]} label={dim.label} />
        ))}
      </div>
    </div>
  );
}
