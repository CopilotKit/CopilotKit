"use client";

import { useState } from "react";
import Link from "next/link";
import { useKeelDesk } from "@/skins/keel/desk-data";
import { StatusPill } from "@/skins/keel/components/status-pill";
import { Button } from "@/components/ui/button";
import type { Run, RunStep } from "@/skins/keel/data/types";
import { useKeelHref } from "@/skins/keel/href";

/** ms → compact human duration; null (no completed run yet) renders as an em dash. */
function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

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

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-4 shadow-soft">
      <div className="text-2xl font-bold tabular-nums text-ink">{value}</div>
      <div className="mt-1 text-xs font-medium uppercase tracking-wide text-ink-muted">
        {label}
      </div>
    </div>
  );
}

export function DeskPage() {
  const keelHref = useKeelHref();
  const data = useKeelDesk();
  const { kpis, approvalsForMe, approvals, runs, persona } = data;

  // Per-gate failure reasons (the stale-approval race, spec §12), keyed run:step.
  const [errors, setErrors] = useState<Record<string, string>>({});

  // The approval is a POST followed by a ledger re-read, so it is awaited before
  // anything on screen changes. `reason` is surfaced whenever it is present —
  // including on a SUCCESS whose re-read failed (`stale`), where the write
  // landed and this list is still showing the state from before it. A green tick
  // over stale rows is indistinguishable from a slow network.
  const handleApprove = async (runId: string, stepId: string) => {
    const key = `${runId}:${stepId}`;
    const result = await data.approveStep(
      runId,
      stepId,
      `Approved by ${persona.name}`,
    );
    setErrors((prev) => {
      const next = { ...prev };
      if (result.ok && !result.reason) delete next[key];
      else next[key] = result.reason ?? "Could not approve this step.";
      return next;
    });
  };

  const blockedOnOthers = approvals.filter((a) => !a.actionable);
  const inFlight = runs.filter((r) => r.status === "running");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">Desk</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Signed in as {persona.name} · {persona.role}
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Open runs" value={kpis.openRuns} />
        <Kpi label="Blocked" value={kpis.blockedRuns} />
        <Kpi label="Approvals for me" value={kpis.approvalsForMe} />
        <Kpi
          label="Median cycle time"
          value={formatDuration(kpis.medianCycleTimeMs)}
        />
      </div>

      {/* Awaiting your approval */}
      <section className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
        <header className="border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">
            Awaiting your approval
          </h2>
        </header>
        {approvalsForMe.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            Nothing is waiting on you right now.
          </p>
        ) : (
          <ul>
            {approvalsForMe.map(({ run, step }) => {
              const key = `${run.id}:${step.id}`;
              const err = errors[key];
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={keelHref(`runs/${run.id}`)}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {run.id}
                      </Link>
                      <span className="truncate text-sm font-medium text-ink">
                        {step.title}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {run.subject}
                    </p>
                    {err && <p className="mt-1 text-xs text-negative">{err}</p>}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(run.id, step.id)}
                  >
                    Approve
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Blocked, waiting on others */}
      <section className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
        <header className="border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">
            Blocked, waiting on others
          </h2>
        </header>
        {blockedOnOthers.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            No approvals are blocked on another role.
          </p>
        ) : (
          <ul>
            {blockedOnOthers.map(({ run, step }) => (
              <li
                key={`${run.id}:${step.id}`}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-0"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={keelHref(`runs/${run.id}`)}
                      className="font-mono text-xs text-brand hover:underline"
                    >
                      {run.id}
                    </Link>
                    <span className="truncate text-sm font-medium text-ink">
                      {step.title}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">{run.subject}</p>
                </div>
                <span className="rounded-sm bg-brand-violet/15 px-2 py-0.5 text-xs font-semibold text-brand-violet">
                  Awaiting {step.approverRole ?? "an approver"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* In flight */}
      <section className="overflow-hidden rounded-lg border border-hairline bg-surface shadow-soft">
        <header className="border-b border-hairline px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">In flight</h2>
        </header>
        {inFlight.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            No runs are in flight.
          </p>
        ) : (
          <ul>
            {inFlight.map((run) => {
              const step = currentStep(run);
              return (
                <li
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        href={keelHref(`runs/${run.id}`)}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {run.id}
                      </Link>
                      <span className="truncate text-sm font-medium text-ink">
                        {run.title}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {step ? step.title : run.subject}
                    </p>
                  </div>
                  <StatusPill status={run.status} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
