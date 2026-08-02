"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Run, RunStep } from "@/skins/keel/data/types";

/**
 * The `approveStep` HITL card — the most important surface in this unit. The
 * step's policyRef is shown as the REASON the gate exists (ref + section,
 * linking to the governing document), so the human is never asked to approve
 * blind. Presentational: the decision goes back through onApprove / onReject.
 */
export function ApprovalCard({
  run,
  step,
  actionable,
  onApprove,
  onReject,
}: {
  run: Run;
  step: RunStep;
  actionable: boolean;
  onApprove: (note?: string) => void;
  onReject: (note?: string) => void;
}) {
  const [note, setNote] = useState("");
  const trimmed = note.trim();
  const noteArg = trimmed.length > 0 ? trimmed : undefined;

  return (
    // `pointer-events-auto`: re-enable clicks on this interactive
    // `useComponent` render — see SourcesCard for the full rationale.
    <div className="pointer-events-auto rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold text-ink-muted">
          {run.id}
        </span>
        <span className="inline-flex items-center gap-1 rounded-sm bg-brand-violet/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-violet">
          <ShieldCheck className="h-3 w-3" />
          Approval gate
        </span>
      </div>

      <div className="mt-1 text-sm font-semibold text-ink">{step.title}</div>
      <div className="mt-0.5 text-xs text-ink-muted">{run.subject}</div>

      {step.policyRef && (
        <Link
          href={`/keel/knowledge/${step.policyRef.docId}#${step.policyRef.sectionId}`}
          className="mt-2 flex flex-col gap-0.5 rounded-md border border-hairline bg-surface-muted p-2 transition-colors hover:border-brand/60"
        >
          <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Why this gate exists
          </span>
          <span className="font-mono text-xs font-semibold text-brand underline-offset-2 hover:underline">
            {step.policyRef.ref} §{step.policyRef.sectionId}
          </span>
        </Link>
      )}

      {actionable ? (
        <div className="mt-3 flex flex-col gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note (optional)"
            className="h-8 text-xs"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="flex-1"
              onClick={() => onApprove(noteArg)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onReject(noteArg)}
            >
              Reject
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-1.5 rounded-md bg-surface-muted px-2 py-1.5 text-xs text-ink-muted">
          <Clock className="h-3.5 w-3.5 text-brand-violet" />
          <span>
            Waiting on{" "}
            <span className="font-medium text-ink">
              {step.approverRole ?? "another approver"}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
