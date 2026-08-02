"use client";

import { Button } from "@/components/ui/button";
import type { ApprovalItem } from "@/skins/keel/data/types";

/**
 * The `showApprovals` chat surface: the current role's approval queue. Each row
 * is actionable only when the gate's approverRole matches the current persona
 * (the `actionable` flag is computed upstream in KeelData). Non-actionable rows
 * name the role the gate is waiting on and disable the button.
 */
export function ApprovalsQueue({
  items,
  onApprove,
}: {
  items: ApprovalItem[];
  onApprove: (runId: string, stepId: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline bg-surface p-3 text-xs text-ink-muted">
        Nothing is waiting on approval right now.
      </div>
    );
  }

  return (
    // `pointer-events-auto`: re-enable clicks on this interactive
    // `useComponent` render — see SourcesCard for the full rationale.
    <div className="pointer-events-auto rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Approvals ({items.length})
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ run, step, actionable }) => (
          <li
            key={`${run.id}:${step.id}`}
            className="flex items-center gap-2 rounded-md bg-surface-muted p-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-semibold text-ink-muted">
                  {run.id}
                </span>
                <span className="truncate text-xs font-medium text-ink">
                  {step.title}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-muted">
                {run.subject}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!actionable && (
                <span className="rounded-sm bg-brand-violet/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-violet">
                  {step.approverRole ?? "Awaiting"}
                </span>
              )}
              <Button
                size="sm"
                disabled={!actionable}
                onClick={() => onApprove(run.id, step.id)}
              >
                Approve
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
