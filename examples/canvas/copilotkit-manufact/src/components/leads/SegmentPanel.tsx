"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Trash2, Users } from "lucide-react";
import type { Lead, Segment } from "@/lib/leads/types";
import { segmentDotClass } from "@/lib/leads/derive";

interface SegmentPanelProps {
  segments: Segment[];
  leadsById: Record<string, Lead>;
  onSelectLead: (id: string) => void;
  onRemove: (id: string) => void;
}

export function SegmentPanel({
  segments,
  leadsById,
  onSelectLead,
  onRemove,
}: SegmentPanelProps) {
  if (segments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 p-3 text-[11px] text-muted-foreground">
        No segments yet. Try: <em>“Create a segment of CopilotKit-curious developers.”</em>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {segments.map((s) => (
        <SegmentItem
          key={s.id}
          segment={s}
          leadsById={leadsById}
          onSelectLead={onSelectLead}
          onRemove={() => onRemove(s.id)}
        />
      ))}
    </ul>
  );
}

function SegmentItem({
  segment,
  leadsById,
  onSelectLead,
  onRemove,
}: {
  segment: Segment;
  leadsById: Record<string, Lead>;
  onSelectLead: (id: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        <span className={`size-2.5 rounded-full ${segmentDotClass(segment.color)}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {segment.name}
          </div>
          {segment.description ? (
            <div className="truncate text-[11px] text-muted-foreground">
              {segment.description}
            </div>
          ) : null}
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <Users className="size-3" />
          {segment.leadIds.length}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-foreground"
          aria-label="Remove segment"
        >
          <Trash2 className="size-3.5" />
        </button>
      </header>
      {open ? (
        <ul className="border-t border-border px-2 py-2">
          {segment.leadIds.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              empty
            </li>
          ) : (
            segment.leadIds.slice(0, 12).map((id) => {
              const lead = leadsById[id];
              if (!lead) return null;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => onSelectLead(id)}
                    className="w-full truncate rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {lead.name}{" "}
                    <span className="text-muted-foreground/60">
                      · {lead.company || lead.role}
                    </span>
                  </button>
                </li>
              );
            })
          )}
          {segment.leadIds.length > 12 ? (
            <li className="px-2 pt-1 text-[11px] text-muted-foreground">
              +{segment.leadIds.length - 12} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}
