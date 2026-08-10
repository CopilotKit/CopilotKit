"use client";

import Link from "next/link";
import { useSkinData } from "@/shell/skin-provider";
import { StatusPill } from "@/skins/keel/components/status-pill";
import { formatDate } from "@/skins/keel/pages/format-date";
import type { KeelData, Run, RunStep } from "@/skins/keel/data/types";
import { useKeelHref } from "@/skins/keel/href";

/** The step a run is "on": the active/gated one, else the next pending, else the last. */
function currentStep(run: Run): RunStep | undefined {
  return (
    run.steps.find(
      (s) => s.status === "running" || s.status === "awaiting_approval",
    ) ??
    run.steps.find((s) => s.status === "pending") ??
    run.steps[run.steps.length - 1]
  );
}

export function RunsPage() {
  const keelHref = useKeelHref();
  const { runs } = useSkinData<KeelData>();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Runs</h1>
        <p className="mt-1 text-sm text-ink-muted">{runs.length} total</p>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-semibold">Run</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Subject</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Current step</th>
                <th className="px-3 py-2 font-semibold">Requested by</th>
                <th className="px-3 py-2 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const step = currentStep(run);
                return (
                  <tr
                    key={run.id}
                    className="border-b border-hairline last:border-0 hover:bg-surface-muted"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={keelHref(`runs/${run.id}`)}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {run.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-medium text-ink">
                      {run.title}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">{run.subject}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={run.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {step ? step.title : "—"}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {run.requestedBy}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink-muted tabular-nums">
                      {formatDate(run.createdAt)}
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-sm text-ink-muted"
                  >
                    No runs yet. Start one from a playbook.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
