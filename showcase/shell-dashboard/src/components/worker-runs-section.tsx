"use client";
/**
 * WorkerRunsSection — the §6.2 "Worker runs" Ops-tab section: heading,
 * family table + worker strip (WorkerRunsTable), row-click drill-down
 * (WorkerRunDetailPanel), and the §6.3 failure surfacing.
 *
 * Consumes the §6.1 poll status from `useWorkerRuns()` (context — the
 * provider is mounted by dashboard-page).
 *
 * NEVER SELF-HIDES (§6.3 — load-bearing): on ANY unavailable state the
 * section renders its heading plus a red error panel with the per-kind
 * message variant, and the dimmed last-good table beneath when a prior
 * poll succeeded (nothing beneath on a cold failure). The dashboard
 * must never look healthy while measurement telemetry is unreachable.
 *
 * §6.3 message variants (keyed by the §6.1 classification):
 *   - `unreachable`    → proxy 5xx / network / parse failure
 *   - `history-backend`→ 200 body with a family-entry
 *                        `history_unavailable` marker (PB down, CP up)
 *   - `misdeploy-404`  → endpoint absent — always the incident class
 *                        (EXPECT_WORKER_RUNS_ENDPOINT, §6.1)
 */
import { useEffect, useState } from "react";

import { formatRelative } from "./status-table";
import { WorkerRunsTable } from "./worker-runs-table";
import { WorkerRunDetailPanel } from "./worker-run-detail-panel";
import { useWorkerRuns } from "../lib/worker-runs-context";
import type { WorkerRunsUnavailableKind } from "../hooks/use-worker-runs";
import type { ProbeScheduleEntry } from "../lib/ops-api";

export interface WorkerRunsSectionProps {
  /**
   * `/api/probes` entries for the subdued starter-cycle row; null/empty
   * when the token-gated probes router is unmounted (§6.2).
   */
  probeEntries: ProbeScheduleEntry[] | null;
}

const UNAVAILABLE_MESSAGE: Record<WorkerRunsUnavailableKind, string> = {
  unreachable: "Worker runs unavailable — ops endpoint unreachable",
  "history-backend":
    "Worker runs unavailable — run history backend unreachable",
  "misdeploy-404":
    "Worker runs unavailable — endpoint disappeared (possible misdeploy)",
};

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function WorkerRunsSection({ probeEntries }: WorkerRunsSectionProps) {
  const status = useWorkerRuns();
  const now = useNowTick();
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);

  return (
    <section
      data-testid="worker-runs-section"
      className="px-8 py-4 flex flex-col gap-3"
    >
      <h2
        data-testid="worker-runs-heading"
        className="text-xs uppercase tracking-wide text-[var(--text-muted)]"
      >
        Worker runs
      </h2>

      {status === null && (
        <div
          data-testid="worker-runs-loading"
          className="text-xs text-[var(--text-muted)]"
        >
          Loading…
        </div>
      )}

      {status?.status === "ok" && (
        <>
          <WorkerRunsTable
            data={status.data}
            probeEntries={probeEntries}
            onSelectFamily={setSelectedFamily}
          />
          <WorkerRunDetailPanel
            family={selectedFamily}
            onClose={() => setSelectedFamily(null)}
          />
        </>
      )}

      {status?.status === "unavailable" && (
        <>
          <div
            data-testid="worker-runs-error-panel"
            data-kind={status.kind}
            className="rounded border border-[var(--danger)] bg-[var(--danger)]/10 px-3 py-2 text-xs text-[var(--danger)]"
          >
            <span>{UNAVAILABLE_MESSAGE[status.kind]}</span>
            {status.lastGood && (
              <span className="ml-2 text-[var(--text-muted)]">
                last good data {formatRelative(status.lastGood.fetchedAt, now)}
              </span>
            )}
          </div>
          {status.lastGood && (
            <div
              data-testid="worker-runs-last-good"
              className="opacity-50 pointer-events-none"
            >
              <WorkerRunsTable
                data={status.lastGood.data}
                probeEntries={probeEntries}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
