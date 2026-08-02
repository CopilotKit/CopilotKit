"use client";

import Link from "next/link";
import { useSkinData } from "@/shell/skin-provider";
import type { KeelData, Playbook } from "@/skins/keel/data/types";

/** The distinct performing roles across a playbook's steps, first-seen order. */
function distinctRoles(playbook: Playbook): string[] {
  return Array.from(new Set(playbook.steps.map((s) => s.role)));
}

/** The distinct governing policy refs, de-duped on docId#sectionId. */
function distinctPolicyRefs(
  playbook: Playbook,
): { docId: string; sectionId: string; ref: string }[] {
  const seen = new Set<string>();
  const out: { docId: string; sectionId: string; ref: string }[] = [];
  for (const step of playbook.steps) {
    if (!step.policyRef) continue;
    const key = `${step.policyRef.docId}#${step.policyRef.sectionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step.policyRef);
  }
  return out;
}

export function PlaybooksPage() {
  const { playbooks } = useSkinData<KeelData>();

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Playbooks</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Automatable processes. Each step is governed by a policy, and approval
          gates halt the run until the right role signs off.
        </p>
      </div>

      {playbooks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline p-8 text-center text-sm text-ink-muted">
          No playbooks are configured.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {playbooks.map((playbook) => {
            const gates = playbook.steps.filter((s) => s.requiresApproval).length;
            const roles = distinctRoles(playbook);
            const refs = distinctPolicyRefs(playbook);
            return (
              <article
                key={playbook.id}
                className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface p-4 shadow-soft"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">
                      {playbook.title}
                    </h2>
                    <span className="rounded-sm bg-surface-muted px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-ink-muted">
                      {playbook.space}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {playbook.summary}
                  </p>
                </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>
                    <span className="font-semibold text-ink">
                      {playbook.steps.length}
                    </span>{" "}
                    steps
                  </span>
                  <span>
                    <span className="font-semibold text-ink">{gates}</span>{" "}
                    approval {gates === 1 ? "gate" : "gates"}
                  </span>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Roles
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {roles.map((role) => (
                      <span
                        key={role}
                        className="rounded-sm bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand"
                      >
                        {role}
                      </span>
                    ))}
                  </div>
                </div>

                {refs.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Governed by
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {refs.map((policyRef) => (
                        <Link
                          key={`${policyRef.docId}#${policyRef.sectionId}`}
                          href={`/keel/knowledge/${policyRef.docId}#${policyRef.sectionId}`}
                          className="font-mono text-xs text-brand underline-offset-2 hover:underline"
                        >
                          {policyRef.ref} §{policyRef.sectionId}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
