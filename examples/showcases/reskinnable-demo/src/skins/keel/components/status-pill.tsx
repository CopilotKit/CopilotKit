"use client";

import type { RunStatus, StepStatus } from "@/skins/keel/data/types";

/** Every status the app renders, unified so one atom covers runs and steps. */
type AnyStatus = RunStatus | StepStatus;

const LABELS: Record<AnyStatus, string> = {
  queued: "Queued",
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
  pending: "Pending",
  awaiting_approval: "Awaiting approval",
  done: "Done",
  failed: "Failed",
};

/**
 * Token-only styling so the pill reskins with the theme. `awaiting_approval`
 * and `blocked` use the amber accent that --brand-violet carries in this skin
 * (see theme.css) — never a raw Tailwind palette color.
 */
const STYLES: Record<AnyStatus, string> = {
  queued: "bg-surface-muted text-ink-muted",
  running: "bg-brand-soft text-brand",
  blocked: "bg-brand-violet/15 text-brand-violet",
  completed: "bg-positive-soft text-positive",
  cancelled: "bg-surface-muted text-ink-muted line-through",
  pending: "bg-surface-muted text-ink-muted",
  awaiting_approval: "bg-brand-violet/15 text-brand-violet",
  done: "bg-positive-soft text-positive",
  failed: "bg-negative-soft text-negative",
};

export function StatusPill({
  status,
  className = "",
}: {
  status: AnyStatus;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STYLES[status]} ${className}`}
    >
      {LABELS[status]}
    </span>
  );
}
