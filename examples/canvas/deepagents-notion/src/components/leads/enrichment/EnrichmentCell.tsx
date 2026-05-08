"use client";

/**
 * EnrichmentCell — one cell in the EnrichmentStream sheet.
 *
 * Sized as a 64px-wide column: a 48px square visual on top, an optional
 * 1-line caption below. Five visual states keyed off `LeadEnrichment.status`:
 *
 *   idle        dotted outline · faded initials · no caption
 *   inflight    solid border · shimmer sweep · skeleton caption line
 *   summarized  full-color avatar · 1-line blurb caption
 *   scored      same as summarized + tier dot in top-right corner
 *   error       destructive border + ⚠ icon · "error" caption
 *
 * The shimmer is pure CSS (see globals.css) so 52 simultaneous cells stay
 * smooth. The tier dot animates in once via `data-enrichment-tier-pop`,
 * which the parent flips on for ~600ms when status transitions to "scored."
 */

import { CircleAlert } from "lucide-react";
import type {
  EnrichmentStatus,
  Lead,
  LeadEnrichment,
  Tier,
} from "@/lib/leads/types";
import { initials } from "@/lib/leads/derive";

const TIER_DOT: Record<Tier, string> = {
  hot: "bg-rose-500",
  warm: "bg-amber-500",
  nurture: "bg-sky-500",
  drop: "bg-slate-400",
};

const STATUS_VISUAL: Record<EnrichmentStatus, string> = {
  idle: "border border-dashed border-border bg-muted/30 text-muted-foreground/40",
  inflight: "border border-primary/40 bg-card text-foreground/80",
  summarized: "border border-border bg-card text-foreground",
  scored: "border border-border bg-card text-foreground",
  error: "border border-destructive/40 bg-destructive/5 text-destructive/80",
};

export interface EnrichmentCellProps {
  lead: Pick<Lead, "id" | "name">;
  enrichment?: LeadEnrichment;
  /** Override the cell's status — used by the showcase page to render every
   *  variation off the same fixture data. Real usage should let
   *  `enrichment.status` drive. */
  forceStatus?: EnrichmentStatus;
  /** Force the corner tier-dot pop animation. Set true for ~600ms then false
   *  when a cell first transitions to "scored." */
  pop?: boolean;
  onClick?: (leadId: string) => void;
}

export function EnrichmentCell({
  lead,
  enrichment,
  forceStatus,
  pop,
  onClick,
}: EnrichmentCellProps) {
  const status: EnrichmentStatus =
    forceStatus ?? enrichment?.status ?? "idle";
  const tier = enrichment?.tier;
  const blurb = enrichment?.blurb;

  return (
    <button
      type="button"
      onClick={() => onClick?.(lead.id)}
      data-enrichment-status={status}
      title={blurb ? `${lead.name}\n${blurb}` : lead.name}
      aria-label={`${lead.name} — ${status}${blurb ? `: ${blurb}` : ""}`}
      className="group flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1 rounded-md p-0.5 outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div
        className={`relative grid size-12 place-items-center overflow-hidden rounded-md text-[11px] font-semibold tabular-nums transition group-hover:scale-[1.04] ${STATUS_VISUAL[status]}`}
      >
        {status === "error" ? (
          <CircleAlert className="size-4" />
        ) : (
          <span className={status === "idle" ? "opacity-50" : ""}>
            {initials(lead.name)}
          </span>
        )}

        {/* Shimmer overlay for inflight (pure CSS, see globals.css). */}
        {status === "inflight" ? (
          <span aria-hidden className="enrichment-shimmer" />
        ) : null}

        {/* Corner tier dot for scored cells. */}
        {status === "scored" && tier ? (
          <span
            aria-hidden
            data-enrichment-tier-pop={pop ? "true" : undefined}
            className={`absolute right-0.5 top-0.5 size-2 rounded-full ring-1 ring-card ${TIER_DOT[tier]}`}
          />
        ) : null}

        {/* Error badge for error cells. */}
        {status === "error" ? (
          <span
            aria-hidden
            className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-destructive ring-1 ring-card"
          />
        ) : null}
      </div>

      {/* Caption below the visual. Always reserves height so the grid is
          even-row regardless of which cells have captions. */}
      <div className="h-3 w-full overflow-hidden">
        {status === "inflight" ? (
          <div className="mx-auto h-1.5 w-3/4 animate-pulse rounded-full bg-muted/70" />
        ) : status === "summarized" || status === "scored" ? (
          <div className="truncate text-center font-mono text-[9px] leading-3 text-muted-foreground">
            {blurb ?? "·"}
          </div>
        ) : status === "error" ? (
          <div className="truncate text-center font-mono text-[9px] leading-3 text-destructive/70">
            error
          </div>
        ) : null}
      </div>
    </button>
  );
}
