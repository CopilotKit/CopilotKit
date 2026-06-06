"use client";

/**
 * EnrichmentDetailCard — the expanded view of one enriched lead.
 *
 * Two contexts:
 *   1. Hover popover anchored to an EnrichmentCell in the sheet.
 *   2. Standalone, when the agent calls `renderEnrichmentDetail({leadId})`
 *      to drop one inline in the chat (a follow-up to "what did you find
 *      out about X?").
 *
 * Same 320px max-width vocabulary as LeadMiniCard / SegmentChip. Score
 * breakdown is shown as a row of weighted mini-bars when present.
 */

import { ExternalLink, MousePointerClick, Sparkles } from "lucide-react";
import type { Lead, LeadEnrichment, Tier } from "@/lib/leads/types";
import { initials } from "@/lib/leads/derive";

const TIER_PILL: Record<Tier, string> = {
  hot: "bg-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30",
  nurture: "bg-sky-500/15 text-sky-700 dark:text-sky-300 ring-sky-500/30",
  drop: "bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-slate-500/30",
};

const TIER_LABEL: Record<Tier, string> = {
  hot: "Hot",
  warm: "Warm",
  nurture: "Nurture",
  drop: "Drop",
};

export interface EnrichmentDetailCardProps {
  lead: Pick<Lead, "id" | "name" | "role" | "company">;
  enrichment: LeadEnrichment;
  onSelect?: (leadId: string) => void;
}

export function EnrichmentDetailCard({
  lead,
  enrichment,
  onSelect,
}: EnrichmentDetailCardProps) {
  const tagline = [lead.role, lead.company].filter(Boolean).join(" @ ");
  const showScore =
    enrichment.status === "scored" && typeof enrichment.score === "number";

  return (
    <div className="my-2 max-w-[320px] rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* Header row: avatar + name + tier pill */}
      <div className="flex items-start gap-2.5">
        <Avatar name={lead.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {lead.name || "(unnamed lead)"}
              </div>
              {tagline ? (
                <div className="truncate text-xs text-muted-foreground">
                  {tagline}
                </div>
              ) : null}
            </div>
            {enrichment.tier ? (
              <span
                className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${TIER_PILL[enrichment.tier]}`}
              >
                {TIER_LABEL[enrichment.tier]}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Blurb */}
      {enrichment.blurb || enrichment.details ? (
        <div className="mt-2.5 flex items-start gap-1.5">
          <Sparkles
            aria-hidden
            className="mt-0.5 size-3 shrink-0 text-secondary"
          />
          <div className="text-[11px] leading-relaxed text-foreground/80">
            {enrichment.details ?? enrichment.blurb}
          </div>
        </div>
      ) : null}

      {/* Score row */}
      {showScore ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Score
          </div>
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-secondary"
              style={{ width: `${Math.min(100, enrichment.score!)}%` }}
            />
          </div>
          <div className="font-mono text-[11px] tabular-nums text-foreground">
            {enrichment.score}
          </div>
        </div>
      ) : null}

      {/* Error message */}
      {enrichment.status === "error" && enrichment.error ? (
        <div className="mt-2 rounded-md bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {enrichment.error}
        </div>
      ) : null}

      {/* Action row */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {onSelect ? (
          <button
            type="button"
            onClick={() => onSelect(lead.id)}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <MousePointerClick className="size-3" />
            Open in canvas
          </button>
        ) : null}
        {enrichment.traceUrl ? (
          <a
            href={enrichment.traceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/10"
          >
            <ExternalLink className="size-3" />
            Trace
          </a>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: `hsl(${hue} 45% 50%)` }}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
