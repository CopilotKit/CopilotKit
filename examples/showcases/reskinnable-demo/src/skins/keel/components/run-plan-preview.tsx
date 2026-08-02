"use client";

import { ListChecks, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Playbook } from "@/skins/keel/data/types";

/**
 * The `startRun` HITL plan preview. Presentational: it derives the plan shape
 * from the playbook and hands the decision back through onConfirm / onCancel.
 */
export function RunPlanPreview({
  playbook,
  subject,
  onConfirm,
  onCancel,
}: {
  playbook: Playbook;
  subject: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const stepCount = playbook.steps.length;
  const gateCount = playbook.steps.filter((s) => s.requiresApproval).length;
  const roleCount = new Set(playbook.steps.map((s) => s.role)).size;

  const stats: { icon: typeof ListChecks; value: number; label: string }[] = [
    {
      icon: ListChecks,
      value: stepCount,
      label: stepCount === 1 ? "step" : "steps",
    },
    {
      icon: ShieldCheck,
      value: gateCount,
      label: gateCount === 1 ? "approval gate" : "approval gates",
    },
    {
      icon: Users,
      value: roleCount,
      label: roleCount === 1 ? "role" : "roles",
    },
  ];

  return (
    // `pointer-events-auto`: re-enable clicks on this interactive
    // `useComponent` render — see SourcesCard for the full rationale.
    <div className="pointer-events-auto rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Start process
      </div>
      <div className="mt-0.5 text-sm font-semibold text-ink">
        {playbook.title}
      </div>
      <div className="mt-0.5 text-xs text-ink-muted">
        Subject: <span className="font-medium text-ink">{subject}</span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map(({ icon: Icon, value, label }) => (
          <div
            key={label}
            className="flex flex-col items-center rounded-md bg-surface-muted p-2 text-center"
          >
            <Icon className="h-4 w-4 text-brand" />
            <span className="mt-1 text-lg font-bold leading-none text-ink">
              {value}
            </span>
            <span className="mt-0.5 text-[10px] leading-tight text-ink-muted">
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Button size="sm" className="flex-1" onClick={onConfirm}>
          Confirm &amp; start
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
