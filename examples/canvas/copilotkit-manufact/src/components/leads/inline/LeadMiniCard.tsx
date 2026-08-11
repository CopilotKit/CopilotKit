"use client";

/**
 * Inline-in-chat lead card. The agent calls `renderLeadMiniCard({leadId, ...})`
 * and CopilotKit renders this in the message stream so the user can click
 * through directly to the lead's detail panel.
 *
 * Resilient by design: the agent may pass props with `result.status === "complete"`
 * and `args` already realized, OR with `status === "inProgress"` while args
 * are streaming in. Display whatever the agent has now and avoid throwing on
 * partial input.
 */

import { Mail, MousePointerClick } from "lucide-react";
import { initials, techLevelClass, workshopClass } from "@/lib/leads/derive";

export interface LeadMiniCardProps {
  /** The Notion page id (Lead.id). */
  leadId?: string;
  name?: string;
  role?: string;
  company?: string;
  email?: string;
  workshop?: string;
  technical_level?: string;
  /** Click handler — typically wired to the `selectLead` frontend tool. */
  onSelect?: (leadId: string) => void;
}

export function LeadMiniCard({
  leadId,
  name,
  role,
  company,
  email,
  workshop,
  technical_level,
  onSelect,
}: LeadMiniCardProps) {
  const displayName = name?.trim() || "(unnamed lead)";
  const tagline = [role, company].filter(Boolean).join(" @ ");

  return (
    <div className="my-2 max-w-[320px] rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <Avatar name={displayName} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {displayName}
          </div>
          {tagline ? (
            <div className="truncate text-xs text-muted-foreground">
              {tagline}
            </div>
          ) : null}
        </div>
      </div>
      {workshop || technical_level ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {workshop ? (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${workshopClass(
                workshop,
              )}`}
            >
              {workshop}
            </span>
          ) : null}
          {technical_level ? (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${techLevelClass(
                technical_level,
              )}`}
            >
              {technical_level}
            </span>
          ) : null}
        </div>
      ) : null}
      {email ? (
        <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Mail className="size-3" />
          <span className="truncate">{email}</span>
        </div>
      ) : null}
      {leadId ? (
        <button
          type="button"
          onClick={() => onSelect?.(leadId)}
          className="mt-3 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <MousePointerClick className="size-3" />
          Open in canvas
        </button>
      ) : null}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
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
