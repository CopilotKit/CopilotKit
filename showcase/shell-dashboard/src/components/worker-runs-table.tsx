"use client";
/**
 * WorkerRunsTable — the §6.2 worker-runs family grid for the Ops tab.
 *
 * One row per `FLEET_FAMILIES` member from the `/api/runs` payload.
 * Columns mirror StatusTable: Family | Schedule (humanizeCron) |
 * Next run (relative) | Last run (relative) | Duration | Outcome |
 * Cells | Reds.
 *
 * RENDER-VERBATIM CONTRACT (§6.2/§6.3 — do not weaken): every
 * outcome/health value here is the SERVER's precedence-derived value,
 * rendered verbatim with zero client-side re-classification. A batch
 * with both failed and zombie-pending jobs arrives as `stalled` and
 * renders `stalled`; worker health arrives from the shared
 * `deriveHealth` and renders online/stale/offline as-is.
 *
 * Beneath the family rows:
 *   - a subdued starter-cycle row sourced from the `/api/probes`
 *     `starter_smoke` entry (the section's only token-gated dependency —
 *     when the probes router is unmounted the row renders its own
 *     "not mounted" variant rather than vanishing, §6.2);
 *   - a worker strip: one chip per worker, `workerId · <health> ·
 *     inUse/max contexts` — amber when stale, red when offline — the
 *     "is anything even claiming?" answer.
 *
 * Relative times update live every 1s via a local tick state, same as
 * StatusTable; the parent owns the data.
 */
import { useEffect, useState } from "react";

import { formatDuration, formatRelative, humanizeCron } from "./status-table";
import type {
  ProbeScheduleEntry,
  WorkerFamilySummary,
  WorkerRunInflight,
  WorkerRunOutcome,
  WorkerRunsResponse,
  WorkerView,
} from "../lib/ops-api";

export interface WorkerRunsTableProps {
  data: WorkerRunsResponse;
  /**
   * The `/api/probes` schedule entries (for the starter-cycle row).
   * `null`/empty = probes endpoint unavailable (token-gated router
   * unmounted) — the starter row renders its not-mounted variant.
   */
  probeEntries: ProbeScheduleEntry[] | null;
  /** Row-click handler — the parent opens the drill-down panel. */
  onSelectFamily?: (family: string) => void;
}

type Tone = "green" | "amber" | "red" | "gray";

const TONE_CLASS: Record<Tone, string> = {
  green: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  red: "text-[var(--danger)]",
  gray: "text-[var(--text-muted)]",
};

/** §6.2 outcome → tone, a closed three-way match over the server value. */
const OUTCOME_TONE: Record<WorkerRunOutcome, Tone> = {
  completed: "green",
  failed: "red",
  stalled: "amber",
};

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Terminal-batch outcome chip — the server's precedence-derived value
 * verbatim (§5.2.1). For a failed batch the deduped comm-error kinds
 * surface as the tooltip (§6.2); they are closed-vocabulary by
 * construction (enum-validated server-side), safe to render.
 *
 * Shared with the drill-down panel's batch rows.
 */
export function OutcomeChip({
  outcome,
  commErrorKinds,
  testId,
}: {
  outcome: WorkerRunOutcome;
  commErrorKinds?: string[];
  testId?: string;
}) {
  const title =
    outcome === "failed" && commErrorKinds && commErrorKinds.length > 0
      ? commErrorKinds.join(", ")
      : undefined;
  return (
    <span
      data-testid={testId}
      data-outcome={outcome}
      title={title}
      className={`inline-block text-xs ${TONE_CLASS[OUTCOME_TONE[outcome]]}`}
    >
      {outcome}
    </span>
  );
}

/**
 * In-flight indicator: gray `running…` with live elapsed + done/total
 * (1s tick, StatusRunningPanel pattern); amber `stalled` verbatim when
 * the server's §5.2.1 rules (a)/(c) tripped — no client re-derivation.
 */
function RunningChip({
  inflight,
  now,
  testId,
}: {
  inflight: WorkerRunInflight;
  now: number;
  testId: string;
}) {
  const startMs = Date.parse(inflight.enqueuedAt);
  const elapsedMs = Number.isFinite(startMs)
    ? Math.max(0, now - startMs)
    : inflight.elapsedMs;
  const j = inflight.jobs;
  const total = j.pending + j.claimed + j.running + j.done + j.failed;
  if (inflight.stalled) {
    return (
      <span
        data-testid={testId}
        data-stalled="true"
        className={`inline-block text-xs ${TONE_CLASS.amber}`}
      >
        stalled · {formatDuration(elapsedMs)} · {j.done}/{total}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-stalled="false"
      className={`inline-block text-xs ${TONE_CLASS.gray}`}
    >
      running… {formatDuration(elapsedMs)} · {j.done}/{total}
    </span>
  );
}

/**
 * Reds column body: `+N / −M`, omitted entirely when both counters are
 * 0 or null (§6.2). Null = honest-unknown (pre-P2 rows / beyond the
 * reds-window cap), also omitted.
 */
function redsText(
  introduced: number | null | undefined,
  cleared: number | null | undefined,
): string | null {
  const i = introduced ?? 0;
  const c = cleared ?? 0;
  if (i === 0 && c === 0) return null;
  return `+${i} / −${c}`;
}

/**
 * Subdued starter-cycle row (§6.2): the in-process probe family from
 * `/api/probes` (`starter_smoke`), appended so the section reads as the
 * complete heavy-cycle picture. When the probes entries are unavailable
 * (token-gated router unmounted) it renders the not-mounted variant —
 * never vanishing silently.
 */
function StarterRow({
  probeEntries,
  now,
}: {
  probeEntries: ProbeScheduleEntry[] | null;
  now: number;
}) {
  const starter = probeEntries?.find((e) => e.id === "starter_smoke");
  const subdued =
    "border-b border-[var(--border)] text-[var(--text-muted)] opacity-70";
  if (!starter) {
    return (
      <tr
        data-testid="worker-runs-starter-row"
        data-variant="not-mounted"
        className={subdued}
      >
        <td colSpan={8} className="py-2 pr-4 text-xs italic">
          starter cycle — probes endpoint not mounted
        </td>
      </tr>
    );
  }
  const nextRunMs = starter.nextRunAt ? Date.parse(starter.nextRunAt) : null;
  const lastStartMs = starter.lastRun
    ? Date.parse(starter.lastRun.startedAt)
    : null;
  const summary = starter.lastRun?.summary;
  return (
    <tr
      data-testid="worker-runs-starter-row"
      data-variant="in-process"
      className={subdued}
    >
      <td className="py-2 pr-4 text-xs">
        starter cycle{" "}
        <span className="inline-block rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px]">
          in-process
        </span>
      </td>
      <td className="py-2 pr-4 text-xs">{humanizeCron(starter.schedule)}</td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {nextRunMs !== null ? formatRelative(nextRunMs, now) : "—"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {lastStartMs !== null ? formatRelative(lastStartMs, now) : "never"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {starter.lastRun ? formatDuration(starter.lastRun.durationMs) : "—"}
      </td>
      <td className="py-2 pr-4 text-xs">
        {starter.lastRun ? starter.lastRun.state : "never run"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {summary ? `${summary.passed}/${summary.total}` : "—"}
      </td>
      <td className="py-2 text-xs" />
    </tr>
  );
}

const HEALTH_CHIP_CLASS: Record<WorkerView["health"], string> = {
  online: "border-[var(--border)] text-[var(--text-secondary)]",
  stale: "border-[var(--amber)] text-[var(--amber)]",
  offline: "border-[var(--danger)] text-[var(--danger)]",
};

/** Worker strip: health rendered verbatim — amber stale, red offline. */
function WorkerStrip({ workers }: { workers: WorkerView[] }) {
  if (workers.length === 0) {
    return (
      <div
        data-testid="worker-strip"
        className="mt-2 text-xs text-[var(--text-muted)]"
      >
        No workers registered.
      </div>
    );
  }
  return (
    <div
      data-testid="worker-strip"
      className="mt-2 flex flex-wrap gap-1.5 text-[11px]"
    >
      {workers.map((w) => (
        <span
          key={w.workerId}
          data-testid={`worker-chip-${w.workerId}`}
          data-health={w.health}
          className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${HEALTH_CHIP_CLASS[w.health]}`}
        >
          <span className="font-mono">{w.workerId}</span>
          <span>·</span>
          <span>{w.health}</span>
          <span>·</span>
          <span className="tabular-nums">
            {w.capacity.inUse}/{w.capacity.max} contexts
          </span>
        </span>
      ))}
    </div>
  );
}

export function WorkerRunsTable({
  data,
  probeEntries,
  onSelectFamily,
}: WorkerRunsTableProps) {
  const now = useNowTick();

  return (
    <div data-testid="worker-runs-table">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="py-2 pr-4">Family</th>
            <th className="py-2 pr-4">Schedule</th>
            <th className="py-2 pr-4">Next run</th>
            <th className="py-2 pr-4">Last run</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Outcome</th>
            <th className="py-2 pr-4">Cells</th>
            <th className="py-2">Reds</th>
          </tr>
        </thead>
        <tbody>
          {data.families.map((f) => (
            <FamilyRow
              key={f.family}
              entry={f}
              now={now}
              onSelectFamily={onSelectFamily}
            />
          ))}
          <StarterRow probeEntries={probeEntries} now={now} />
        </tbody>
      </table>
      <WorkerStrip workers={data.workers} />
    </div>
  );
}

function FamilyRow({
  entry,
  now,
  onSelectFamily,
}: {
  entry: WorkerFamilySummary;
  now: number;
  onSelectFamily?: (family: string) => void;
}) {
  const lastRun = entry.lastRun ?? null;
  const inflight = entry.inflight ?? null;
  // §6.3: failed lastRun → red left border (the existing red-row
  // convention). Derived from the server outcome value only.
  const failedBorder =
    lastRun?.outcome === "failed" ? "border-l-2 border-l-[var(--danger)]" : "";
  const nextRunMs = entry.nextRunAt ? Date.parse(entry.nextRunAt) : null;
  const lastStartMs = lastRun ? Date.parse(lastRun.enqueuedAt) : null;
  const reds = lastRun
    ? redsText(lastRun.redsIntroduced, lastRun.redsCleared)
    : null;
  const cells = lastRun?.cells ?? null;

  return (
    <tr
      data-testid={`worker-runs-row-${entry.family}`}
      onClick={onSelectFamily ? () => onSelectFamily(entry.family) : undefined}
      className={`border-b border-[var(--border)] hover:bg-[var(--surface-hover)] ${
        onSelectFamily ? "cursor-pointer" : ""
      } ${failedBorder}`}
    >
      <td className="py-2 pr-4 text-xs">{entry.label}</td>
      <td className="py-2 pr-4 text-xs text-[var(--text-secondary)]">
        {entry.schedule ? humanizeCron(entry.schedule) : "—"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {nextRunMs !== null && Number.isFinite(nextRunMs)
          ? formatRelative(nextRunMs, now)
          : "—"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {lastStartMs !== null && Number.isFinite(lastStartMs)
          ? formatRelative(lastStartMs, now)
          : "never"}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {lastRun?.durationMs != null ? formatDuration(lastRun.durationMs) : "—"}
      </td>
      <td className="py-2 pr-4 text-xs">
        {inflight ? (
          <RunningChip
            inflight={inflight}
            now={now}
            testId={`worker-runs-row-${entry.family}-running`}
          />
        ) : lastRun ? (
          <OutcomeChip
            outcome={lastRun.outcome}
            commErrorKinds={lastRun.commErrorKinds}
            testId={`worker-runs-row-${entry.family}-outcome`}
          />
        ) : (
          <span className="text-xs text-[var(--text-muted)]">never run</span>
        )}
      </td>
      <td className="py-2 pr-4 text-xs tabular-nums">
        {cells
          ? cells.failed > 0
            ? `${cells.passed}/${cells.total} (${cells.failed} fail)`
            : `${cells.passed}/${cells.total}`
          : "—"}
      </td>
      <td
        className="py-2 text-xs tabular-nums"
        data-testid={`worker-runs-row-${entry.family}-reds`}
      >
        {reds}
      </td>
    </tr>
  );
}
