"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { Playbook } from "@/skins/keel/data/types";

/**
 * The `showPlaybook` chat surface: a process at a glance before it is started.
 * Every step names its role and governing policy; gated steps carry the amber
 * approval marker that --brand-violet supplies in this skin.
 */
export function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const gateCount = playbook.steps.filter((s) => s.requiresApproval).length;

  return (
    <div className="rounded-lg border border-hairline bg-surface p-3 shadow-soft">
      <div className="text-sm font-semibold text-ink">{playbook.title}</div>
      <p className="mt-0.5 text-xs leading-snug text-ink-muted">
        {playbook.summary}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium text-ink-muted">
        <span>{playbook.steps.length} steps</span>
        <span>
          {gateCount} approval {gateCount === 1 ? "gate" : "gates"}
        </span>
      </div>

      <ol className="mt-3 flex flex-col gap-1.5">
        {playbook.steps.map((step, i) => (
          <li
            key={step.id}
            className="flex items-start gap-2 rounded-md bg-surface-muted p-2"
          >
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-surface font-mono text-[11px] font-semibold text-ink-muted">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-ink">
                  {step.title}
                </span>
                {step.requiresApproval && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-brand-violet/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-violet">
                    <ShieldCheck className="h-3 w-3" />
                    {step.approverRole ?? "Approval"}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-muted">
                <span>{step.role}</span>
                {step.policyRef && (
                  <Link
                    href={`/keel/knowledge/${step.policyRef.docId}#${step.policyRef.sectionId}`}
                    className="font-mono text-brand underline-offset-2 hover:underline"
                  >
                    {step.policyRef.ref} §{step.policyRef.sectionId}
                  </Link>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
