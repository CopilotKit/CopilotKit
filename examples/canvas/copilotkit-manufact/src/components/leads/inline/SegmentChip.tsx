"use client";

/**
 * Inline-in-chat "proposed segment" chip. The agent calls
 * `renderSegmentProposal({...})` BEFORE committing the segment so the user
 * can Accept (turns into an `addSegment` call), Edit (injects an edit prompt
 * into chat), or Discard.
 *
 * The agent never blocks on the user's choice; this is generative UI for
 * preview, not a hard interrupt. If the user does nothing, no segment is
 * created.
 */

import { Check, Pencil, Users, X } from "lucide-react";
import type { SegmentColor } from "@/lib/leads/types";
import { segmentDotClass } from "@/lib/leads/derive";

export interface SegmentChipProps {
  name?: string;
  description?: string;
  color?: SegmentColor;
  leadIds?: string[];
  /** Accept the proposal — should commit via `addSegment`. */
  onAccept?: (args: {
    name: string;
    description?: string;
    color?: SegmentColor;
    leadIds: string[];
  }) => void;
  /** Edit the proposal — typically injects a prompt into chat. */
  onEdit?: (currentName: string) => void;
  /** Discard — usually a no-op, just dismisses the inline UI from the user's
   *  perspective. */
  onDiscard?: () => void;
}

export function SegmentChip({
  name,
  description,
  color,
  leadIds,
  onAccept,
  onEdit,
  onDiscard,
}: SegmentChipProps) {
  const displayName = name?.trim() || "(unnamed segment)";
  const ids = leadIds ?? [];

  return (
    <div className="my-2 max-w-[360px] rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 size-2.5 shrink-0 rounded-full ${segmentDotClass(color)}`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Proposed segment
          </div>
          <div className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </div>
          {description ? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </div>
          ) : null}
          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Users className="size-3" />
            {ids.length} {ids.length === 1 ? "lead" : "leads"}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() =>
            onAccept?.({
              name: displayName,
              description,
              color,
              leadIds: ids,
            })
          }
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Check className="size-3" /> Accept
        </button>
        <button
          type="button"
          onClick={() => onEdit?.(displayName)}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/40"
        >
          <Pencil className="size-3" /> Edit
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
