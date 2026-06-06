"use client";

/**
 * EnrichmentStream — the long-running pillar made visible.
 *
 * A bottom-anchored sheet that shows one cell per lead in a tight grid
 * (defaults to 13 columns × 4 rows for ~52 leads). Each cell reads its
 * own slice of `state.perLead[leadId]` and renders the appropriate
 * status visual.
 *
 * Lifecycle on the canvas:
 *   1. Agent starts enrichment → `state.isActive = true` → sheet slides up
 *   2. Cells transition idle → inflight → summarized → scored
 *   3. Last cell completes → `state.isActive = false`,
 *      `completedAt` is set → caller animates the sheet collapsing into
 *      an EnrichmentPill in the top bar
 *
 * The sheet itself is presentation-only. Sheet ↔ pill animation is owned
 * by the parent so the pill can persist after the sheet unmounts.
 */

import { useMemo } from "react";
import { Sparkles, X } from "lucide-react";
import type {
  EnrichmentState,
  EnrichmentStatus,
  Lead,
} from "@/lib/leads/types";
import { EnrichmentCell } from "./EnrichmentCell";

export interface EnrichmentStreamProps {
  state: EnrichmentState;
  leads: Pick<Lead, "id" | "name">[];
  /** Cells per row. Defaults to 13 (so 52 leads = 4 even rows). */
  columns?: number;
  /** Optional click-through to a per-lead detail. */
  onCellClick?: (leadId: string) => void;
  /** Collapses the sheet → pill. Hides the X if not provided. */
  onClose?: () => void;
}

export function EnrichmentStream({
  state,
  leads,
  columns = 13,
  onCellClick,
  onClose,
}: EnrichmentStreamProps) {
  const counts = useMemo(() => deriveCounts(state, leads.length), [state, leads.length]);
  const total = leads.length;
  const progressPct =
    total === 0 ? 0 : Math.round(((counts.summarized + counts.scored) / total) * 100);

  const elapsed = useElapsedLabel(state);
  const headline = state.isActive
    ? "Enriching leads"
    : state.completedAt
      ? "Enrichment complete"
      : "Enrichment idle";

  return (
    <section
      role="region"
      aria-label="Lead enrichment progress"
      className="flex w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-border/60 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles
            className={`size-3.5 ${state.isActive ? "text-secondary" : "text-muted-foreground"}`}
            aria-hidden
          />
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {headline}
          </h3>
          {elapsed ? (
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
              · {elapsed}
            </span>
          ) : null}
        </div>

        <div className="flex flex-1 items-center gap-2">
          <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-secondary transition-[width] duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {counts.summarized + counts.scored} / {total}
          </span>
        </div>

        <CountChips counts={counts} />

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse enrichment panel"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </header>

      {/* Grid */}
      <div
        className="grid gap-x-1 gap-y-2 p-3"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {leads.length === 0 ? (
          <div className="col-span-full grid place-items-center py-6 text-center text-[11px] text-muted-foreground/70">
            No leads loaded yet — ask the agent to import them first.
          </div>
        ) : (
          leads.map((lead) => (
            <EnrichmentCell
              key={lead.id}
              lead={lead}
              enrichment={state.perLead[lead.id]}
              onClick={onCellClick}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface StatusCounts {
  idle: number;
  inflight: number;
  summarized: number;
  scored: number;
  error: number;
}

function deriveCounts(state: EnrichmentState, total: number): StatusCounts {
  const counts: StatusCounts = {
    idle: 0,
    inflight: 0,
    summarized: 0,
    scored: 0,
    error: 0,
  };
  let seen = 0;
  for (const e of Object.values(state.perLead)) {
    counts[e.status] += 1;
    seen += 1;
  }
  counts.idle += Math.max(0, total - seen);
  return counts;
}

function CountChips({ counts }: { counts: StatusCounts }) {
  const chips: { label: string; value: number; className: string }[] = [
    {
      label: "in flight",
      value: counts.inflight,
      className: "bg-secondary/15 text-secondary ring-secondary/30",
    },
    {
      label: "scored",
      value: counts.scored,
      className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30",
    },
    {
      label: "errors",
      value: counts.error,
      className: "bg-destructive/15 text-destructive ring-destructive/30",
    },
  ];
  return (
    <ul className="flex shrink-0 items-center gap-1.5">
      {chips
        .filter((c) => c.value > 0)
        .map((c) => (
          <li
            key={c.label}
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${c.className}`}
          >
            <span className="font-mono tabular-nums">{c.value}</span>
            <span className="opacity-80">{c.label}</span>
          </li>
        ))}
    </ul>
  );
}

function useElapsedLabel(state: EnrichmentState): string | null {
  // Static elapsed: in real usage this would tick via an interval; for the
  // showcase we render the snapshot whatever the caller supplies. If the run
  // is complete and we have both timestamps, show total elapsed; otherwise
  // surface nothing (the progress bar carries the live signal).
  if (!state.startedAt) return null;
  if (state.completedAt) {
    const ms = Date.parse(state.completedAt) - Date.parse(state.startedAt);
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return formatSeconds(ms / 1000);
  }
  return null;
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}
