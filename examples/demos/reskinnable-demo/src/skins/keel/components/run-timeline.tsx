"use client";

import Link from "next/link";
import type { Run, RunStep } from "@/skins/keel/data/types";
import { useKeelHref } from "@/skins/keel/href";
import { formatStepTime } from "./format-step-time";
import { StatusPill } from "./status-pill";

export interface RunTimelineProps {
  run: Run;
  /** Compact mode drops timestamps — used by the in-chat variant. */
  compact?: boolean;
  /** Rendered under a step when supplied; the approve/reject affordance. */
  renderStepAction?: (step: RunStep) => React.ReactNode;
}

/**
 * The step timeline. Shared by the run-detail page and the in-chat `showRun`
 * component, so it must not assume either context — no data-hook calls, no
 * router use beyond the policy link. Everything arrives via props.
 */
export function RunTimeline({
  run,
  compact = false,
  renderStepAction,
}: RunTimelineProps) {
  const keelHref = useKeelHref();
  return (
    <ol className="flex flex-col">
      {run.steps.map((step, i) => {
        const isLast = i === run.steps.length - 1;
        const stepTime = compact ? null : formatStepTime(step.completedAt);
        return (
          <li key={step.id} className="flex gap-3">
            {/* Rail */}
            <div className="flex flex-col items-center">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                  step.status === "done"
                    ? "bg-positive"
                    : step.status === "running"
                      ? "bg-brand"
                      : step.status === "awaiting_approval"
                        ? "bg-brand-violet"
                        : step.status === "failed"
                          ? "bg-negative"
                          : "bg-hairline"
                }`}
              />
              {!isLast && <span className="w-px flex-1 bg-hairline" />}
            </div>

            {/* Body */}
            <div className={`flex-1 ${isLast ? "pb-0" : "pb-4"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {step.title}
                </span>
                <StatusPill status={step.status} />
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{step.role}</span>
                {step.requiresApproval && step.approverRole && (
                  <span>Approver: {step.approverRole}</span>
                )}
                {step.policyRef && (
                  <Link
                    href={`${keelHref(`knowledge/${step.policyRef.docId}`)}#${step.policyRef.sectionId}`}
                    className="font-mono text-brand underline-offset-2 hover:underline"
                  >
                    {step.policyRef.ref} §{step.policyRef.sectionId}
                  </Link>
                )}
                {stepTime && <span className="font-mono">{stepTime}</span>}
                {step.approvedBy && <span>Approved by {step.approvedBy}</span>}
                {step.rejectedBy && <span>Rejected by {step.rejectedBy}</span>}
              </div>

              {renderStepAction?.(step)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
