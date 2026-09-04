"use client";

/**
 * RubricProposalCard — *soft* HITL: the agent proposes a rubric inline in
 * chat and the user can Accept / Tune / Discard. The agent does not block;
 * if the user does nothing, the rubric isn't applied.
 *
 * Mirrors the SegmentChip scaffolding (eyebrow / title / body / actions)
 * but adds:
 *   - per-dimension weight bars
 *   - delta indicators (▲ / ▼) when this is an *update* proposal —
 *     `previousWeights` populated → bars show movement
 *
 * Wired via `useFrontendTool({ name: "renderRubricProposal", render })`.
 * Soft HITL. The companion SendQueueModal demonstrates *hard* HITL via
 * `useInterrupt`.
 */

import { ArrowDown, ArrowUp, Check, Pencil, Sparkles, X } from "lucide-react";
import type { RubricDimension, RubricProposal } from "@/lib/leads/types";

export interface RubricProposalCardProps {
  proposal: RubricProposal;
  onApply?: (proposal: RubricProposal) => void;
  onTune?: (proposal: RubricProposal) => void;
  onDiscard?: () => void;
}

export function RubricProposalCard({
  proposal,
  onApply,
  onTune,
  onDiscard,
}: RubricProposalCardProps) {
  const isUpdate = !!proposal.previousWeights;

  return (
    <div className="my-2 max-w-[380px] rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Sparkles
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-secondary"
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isUpdate ? "Proposed rubric update" : "Proposed rubric"}
          </div>
          <div className="truncate text-sm font-semibold text-foreground">
            {proposal.name || "(unnamed rubric)"}
          </div>
          {proposal.description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {proposal.description}
            </div>
          ) : null}
          {proposal.reason ? (
            <div className="mt-1 rounded-md bg-secondary/5 px-2 py-1 text-[11px] italic text-secondary/80 ring-1 ring-inset ring-secondary/20">
              {proposal.reason}
            </div>
          ) : null}
        </div>
      </div>

      {/* Dimensions */}
      <ul className="mt-3 flex flex-col gap-1.5">
        {proposal.dimensions.map((dim) => {
          const prev = proposal.previousWeights?.[dim.id];
          return (
            <DimensionRow
              key={dim.id}
              dimension={dim}
              previous={prev}
            />
          );
        })}
      </ul>

      {/* Footer / actions */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onApply?.(proposal)}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Check className="size-3" /> Apply
        </button>
        <button
          type="button"
          onClick={() => onTune?.(proposal)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/10"
        >
          <Pencil className="size-3" /> Tune
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" /> Discard
        </button>
      </div>
    </div>
  );
}

function DimensionRow({
  dimension,
  previous,
}: {
  dimension: RubricDimension;
  previous?: number;
}) {
  const value = clamp100(dimension.weight);
  const delta =
    typeof previous === "number" ? value - clamp100(previous) : null;

  return (
    <li
      className="grid grid-cols-[110px_1fr_44px] items-center gap-2"
      title={dimension.description}
    >
      <span className="truncate text-[11px] text-foreground">
        {dimension.label}
      </span>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {/* Previous-position marker (if updating) */}
        {typeof previous === "number" ? (
          <span
            className="absolute inset-y-0 w-0.5 bg-muted-foreground/60"
            style={{ left: `${clamp100(previous)}%` }}
            aria-hidden
          />
        ) : null}
        {/* Current weight bar */}
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-secondary transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="flex items-center justify-end gap-1 font-mono text-[11px] tabular-nums">
        {delta !== null && delta !== 0 ? (
          <span
            className={`inline-flex items-center gap-0.5 text-[9px] ${
              delta > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {delta > 0 ? (
              <ArrowUp className="size-2.5" />
            ) : (
              <ArrowDown className="size-2.5" />
            )}
            {Math.abs(delta)}
          </span>
        ) : null}
        <span className="text-foreground">{value}</span>
      </span>
    </li>
  );
}

function clamp100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}
