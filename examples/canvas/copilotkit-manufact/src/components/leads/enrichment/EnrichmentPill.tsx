"use client";

/**
 * EnrichmentPill — the collapsed-into-the-top-bar form of EnrichmentStream.
 *
 * Two modes:
 *   - active: live progress, secondary-tint dot, "{done} / {total} · {ETA}"
 *   - complete: muted, emerald check, "{total} enriched · {elapsed}"
 *
 * Click the pill to re-expand the sheet (caller wires `onClick` to flip
 * the layout state).
 *
 * Same horizontal scale as the existing top-bar chips so it slots into the
 * Header without additional vertical stretching.
 */

import { Check, Sparkles } from "lucide-react";
import type { EnrichmentState } from "@/lib/leads/types";

export interface EnrichmentPillProps {
  state: EnrichmentState;
  total: number;
  /** Re-expands the EnrichmentStream sheet. */
  onClick?: () => void;
}

export function EnrichmentPill({ state, total, onClick }: EnrichmentPillProps) {
  const counts = countByStatus(state);
  const done = counts.scored + counts.summarized;
  const errors = counts.error;
  const isComplete = !state.isActive && state.completedAt !== null;

  // Active label: "{done} / {total} enriched"; complete label: "{total} enriched"
  const label = isComplete
    ? `${total} enriched`
    : `${done} / ${total} enriched`;

  const elapsed =
    state.startedAt && state.completedAt
      ? formatSeconds(
          (Date.parse(state.completedAt) - Date.parse(state.startedAt)) / 1000,
        )
      : null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}${elapsed ? ` in ${elapsed}` : ""}. Click to expand.`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isComplete
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
          : "border-secondary/30 bg-secondary/10 text-secondary hover:bg-secondary/15"
      }`}
    >
      {isComplete ? (
        <Check aria-hidden className="size-3" />
      ) : (
        <Sparkles aria-hidden className="size-3" />
      )}
      <span className="font-mono tabular-nums">{label}</span>
      {elapsed ? (
        <span className="font-mono text-[10px] tabular-nums opacity-70">
          · {elapsed}
        </span>
      ) : null}
      {errors > 0 ? (
        <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 py-0 text-[10px] text-destructive ring-1 ring-inset ring-destructive/30">
          <span className="font-mono tabular-nums">{errors}</span>
          <span className="opacity-80">⚠</span>
        </span>
      ) : null}
    </button>
  );
}

function countByStatus(state: EnrichmentState) {
  const counts = { idle: 0, inflight: 0, summarized: 0, scored: 0, error: 0 };
  for (const e of Object.values(state.perLead)) {
    counts[e.status] += 1;
  }
  return counts;
}

function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}
