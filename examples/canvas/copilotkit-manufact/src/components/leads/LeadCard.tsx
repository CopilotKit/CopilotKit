"use client";

import { motion } from "motion/react";
import { Mail, ExternalLink, Check } from "lucide-react";
import type { Lead, Segment } from "@/lib/leads/types";
import {
  initials,
  techLevelClass,
  workshopClass,
  segmentDotClass,
} from "@/lib/leads/derive";
import { usePulse } from "@/lib/leads/hooks";

interface LeadCardProps {
  lead: Lead;
  selected?: boolean;
  highlighted?: boolean;
  /**
   * Watched by `usePulse` to drive a 2s ring-pulse when an id NEWLY enters
   * the list. Pass the same array used to compute `highlighted` — the pulse
   * fires on the transition, the ring style stays for the duration.
   */
  highlightedLeadIds?: string[];
  segments?: Segment[];
  onClick?: () => void;
  compact?: boolean;
  /**
   * Phase 04: drive the spinner overlay (data-syncing) and the post-write
   * ring flash (data-just-synced). Both are CSS-only — the page-level write
   * orchestration in `app/page.tsx` owns the timing.
   */
  syncing?: boolean;
  justSynced?: boolean;
}

export function LeadCard({
  lead,
  selected,
  highlighted,
  highlightedLeadIds,
  segments,
  onClick,
  compact,
  syncing,
  justSynced,
}: LeadCardProps) {
  const pulsing = usePulse(lead.id, highlightedLeadIds ?? []);
  const ring = selected
    ? "ring-2 ring-primary"
    : highlighted
      ? "ring-2 ring-amber-400"
      : "ring-1 ring-border";
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      layoutId={`lead-${lead.id}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
      data-pulse={pulsing ? "true" : "false"}
      data-syncing={syncing ? "true" : undefined}
      data-just-synced={justSynced ? "true" : undefined}
      className={`group relative flex w-full flex-col items-stretch gap-2.5 rounded-lg bg-card p-3 text-left transition hover:bg-accent/40 ${ring}`}
    >
      {segments && segments.length > 0 ? (
        <div className="absolute right-2 top-2 flex gap-1">
          {segments.slice(0, 4).map((s) => (
            <span
              key={s.id}
              title={s.name}
              className={`size-2 rounded-full ${segmentDotClass(s.color)}`}
            />
          ))}
        </div>
      ) : null}
      <div className="flex items-start gap-2.5">
        <Avatar name={lead.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-foreground">
            {lead.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {lead.role}
            {lead.company ? ` @ ${lead.company}` : null}
          </div>
        </div>
      </div>

      {!compact ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(
                lead.workshop,
              )}`}
            >
              {lead.workshop}
            </span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(
                lead.technical_level,
              )}`}
            >
              {lead.technical_level}
            </span>
          </div>

          {lead.tools.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {lead.tools.slice(0, 5).map((t) => (
                <span
                  key={t}
                  className={`rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] text-muted-foreground ${
                    t === "CopilotKit" ? "ring-1 ring-primary/40 text-foreground" : ""
                  }`}
                >
                  {t}
                </span>
              ))}
              {lead.tools.length > 5 ? (
                <span className="text-[10px] text-muted-foreground">
                  +{lead.tools.length - 5}
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1 truncate">
              <Mail className="size-3 shrink-0" />
              <span className="truncate">{lead.email}</span>
            </span>
            {lead.opt_in ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="size-3" />
                opt-in
              </span>
            ) : (
              <span className="text-muted-foreground/70">no opt-in</span>
            )}
          </div>
        </>
      ) : null}
    </motion.button>
  );
}

function Avatar({ name }: { name: string }) {
  // Stable hue from name hash so each lead has a consistent color.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
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

interface InlineLeadLinkProps {
  url?: string;
  className?: string;
}

export function NotionLink({ url, className }: InlineLeadLinkProps) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${className ?? ""}`}
    >
      open in Notion <ExternalLink className="size-3" />
    </a>
  );
}
