"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatSurface } from "@/skins/keel/components/chat-surface";
import type { ApprovalItem, MutationResult } from "@/skins/keel/data/types";

/**
 * The `showApprovals` chat surface: the current role's approval queue. Each row
 * is actionable only when the gate's approverRole matches the current persona
 * (the `actionable` flag is computed upstream in KeelData). Non-actionable rows
 * name the role the gate is waiting on and disable the button.
 */
export function ApprovalsQueue({
  items,
  onApprove,
  errors,
}: {
  items: ApprovalItem[];
  onApprove: (runId: string, stepId: string) => void;
  /**
   * Per-row failure reasons keyed `run:step` (e.g. the stale-approval race,
   * spec §12), shown beneath the row so a failed Approve is never silent.
   */
  errors?: Record<string, string>;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-hairline bg-surface p-3 text-xs text-ink-muted">
        Nothing is waiting on approval right now.
      </div>
    );
  }

  return (
    // Rooted in `ChatSurface` (which carries `pointer-events-auto`) so the
    // per-row Approve buttons stay clickable in chat — see ChatSurface for the
    // full rationale.
    <ChatSurface className="rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Approvals ({items.length})
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map(({ run, step, actionable }) => {
          const err = errors?.[`${run.id}:${step.id}`];
          return (
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
                {err && (
                  <div className="mt-1 text-[11px] text-negative">{err}</div>
                )}
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
          );
        })}
      </ul>
    </ChatSurface>
  );
}

/**
 * Stateful wrapper for `ApprovalsQueue` used by the `showApprovals` chat
 * surface. It owns the per-row failure state so the quick-approve path relays
 * the `MutationResult` the same way every other approval path in this skin does
 * (see `approveStep`/`rejectStep` in tools.tsx, and the desk/run-detail pages).
 *
 * The MutationResult MUST be consumed here: the critical case is the stale-gate
 * race (spec §12) — the 900ms ticker advances the run between the agent
 * proposing the approval and the click, so `approve` returns `{ ok:false }`
 * WITH THE SAME `runs` reference. That produces no re-render, so if the result
 * were discarded the button would appear to do nothing. Surfacing `reason`
 * beneath the row is the only feedback the user gets.
 */
export function ApprovalsQueueSurface({
  items,
  approve,
}: {
  items: ApprovalItem[];
  approve: (runId: string, stepId: string) => MutationResult;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const handleApprove = useCallback(
    (runId: string, stepId: string) => {
      const key = `${runId}:${stepId}`;
      const result = approve(runId, stepId);
      setErrors((prev) => {
        const next = { ...prev };
        if (result.ok) delete next[key];
        else next[key] = result.reason ?? "Could not approve this step.";
        return next;
      });
    },
    [approve],
  );
  return (
    <ApprovalsQueue items={items} onApprove={handleApprove} errors={errors} />
  );
}
