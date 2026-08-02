"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useSkinData } from "@/shell/skin-provider";
import { useRole } from "@/skins/keel/role-context";
import { StatusPill } from "@/skins/keel/components/status-pill";
import { RunTimeline } from "@/skins/keel/components/run-timeline";
import { Button } from "@/components/ui/button";
import type { KeelData, RunStep } from "@/skins/keel/data/types";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function RunDetailPage() {
  // All hooks run unconditionally BEFORE the not-found early return.
  const params = useParams<{ skin: string; rest?: string[] }>();
  const data = useSkinData<KeelData>();
  const { persona } = useRole();
  // Per-step action failures (stale-approval race / wrong state), keyed by step id.
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});

  const runId = params.rest?.[1];
  const run = runId ? data.getRun(runId) : undefined;

  if (!run) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 py-16 text-center">
        <h1 className="text-2xl font-bold text-ink">Run not found</h1>
        <p className="text-sm text-ink-muted">
          {runId
            ? `No run matches "${runId}".`
            : "No run was specified."}{" "}
          It may have been cancelled, or the link is stale.
        </p>
      </div>
    );
  }

  const runForActions = run;

  const handleAction = (kind: "approve" | "reject", stepId: string) => {
    const note = `${kind === "approve" ? "Approved" : "Rejected"} by ${persona.name}`;
    const result =
      kind === "approve"
        ? data.approveStep(runForActions.id, stepId, note)
        : data.rejectStep(runForActions.id, stepId, note);
    setActionErrors((prev) => {
      const next = { ...prev };
      if (result.ok) delete next[stepId];
      else next[stepId] = result.reason ?? "This step could not be updated.";
      return next;
    });
  };

  const renderStepAction = (step: RunStep) => {
    if (step.status !== "awaiting_approval") return null;

    // A gate for a different role: show who it waits on, no actionable buttons.
    if (step.approverRole !== persona.role) {
      return (
        <div className="mt-2 text-xs font-medium text-brand-violet">
          Waiting on {step.approverRole ?? "an approver"}
        </div>
      );
    }

    const err = actionErrors[step.id];
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleAction("approve", step.id)}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction("reject", step.id)}
          >
            Reject
          </Button>
        </div>
        {err && <p className="text-xs text-negative">{err}</p>}
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header className="rounded-lg border border-hairline bg-surface p-5 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm text-ink-muted">{run.id}</span>
          <StatusPill status={run.status} />
        </div>
        <h1 className="mt-2 text-xl font-bold text-ink">{run.title}</h1>
        <p className="mt-1 text-sm text-ink-muted">{run.subject}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>Requested by {run.requestedBy}</span>
          <span className="font-mono tabular-nums">
            {formatDate(run.createdAt)}
          </span>
        </div>
      </header>

      <section className="rounded-lg border border-hairline bg-surface p-5 shadow-soft">
        <h2 className="mb-4 text-sm font-semibold text-ink">Steps</h2>
        <RunTimeline run={run} renderStepAction={renderStepAction} />
      </section>
    </div>
  );
}
