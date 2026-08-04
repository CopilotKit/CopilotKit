"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRole } from "@/skins/keel/role-context";
import type {
  ApprovalItem,
  EngineMutationResult,
  KeelData,
  KeelKpis,
  MutationResult,
  Playbook,
  Run,
  StartRunInput,
  StartRunResult,
} from "./types";
import {
  approveStep as engineApproveStep,
  cancelRun as engineCancelRun,
  nextRunId,
  rejectStep as engineRejectStep,
  startRun as engineStartRun,
  tick,
} from "./engine";
import { KEEL_PLAYBOOKS, seedKeelRuns } from "./seed";

const TICK_MS = 900;

/** Wall-clock cycle time of a completed run: first start → last completion. */
function runCycleTimeMs(run: Run): number | null {
  if (run.status !== "completed") return null;
  const completions = run.steps
    .map((s) => s.completedAt)
    .filter((v): v is string => Boolean(v))
    .map((v) => Date.parse(v));
  if (completions.length === 0) return null;
  const start = Date.parse(run.steps[0]?.startedAt ?? run.createdAt);
  const end = Math.max(...completions);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function useKeelData(): KeelData {
  const { persona } = useRole();
  const playbooks: Playbook[] = KEEL_PLAYBOOKS;

  const [runs, setRuns] = useState<Run[]>(() => seedKeelRuns());

  // Refs back the write callbacks' SYNCHRONOUS commit base + the functional
  // fast-path only — they no longer serve reads (getRun reads reactive `runs`).
  // Keeping the mutation callbacks off reactive `runs` is what lets them stay
  // referentially stable across the 900ms tick, so the agent-context readables
  // in tools.tsx (memoized on summaryKey) do not re-register on every commit.
  // The effect re-syncs it after every render commit (never during render, per
  // the ref convention in banking's tools.tsx); `commit` ALSO advances it
  // synchronously from its event handler so a same-batch sibling composes on the
  // previous sibling's committed result. Between those two writers the ref is the
  // freshest runs a mutation can see synchronously — which is what lets `commit`
  // return an honest ok/reason under a same-batch double dispatch. It is NOT an
  // always-committed value: a synchronous advance can be superseded by a
  // recompute, and a ticker-deferred dispatch reads a stale mirror — that is the
  // documented residual (see `commit`).
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  const personaRef = useRef(persona);
  useEffect(() => {
    personaRef.current = persona;
  }, [persona]);

  // Monotonic source of new run ids. `seedIdFloor` is the highest id already in
  // the seed (a pure derivation, never a render-time ref read); `runStartCountRef`
  // counts how many runs this session has started and is touched ONLY inside the
  // startRun event handler — never during render — so it satisfies the repo's
  // react-hooks/refs rule the way runsRef/personaRef do. Minting the id off this
  // counter (not off the possibly-stale committed list) is what makes it honest
  // under a race: two startRuns in one commit batch get two DISTINCT ids, each
  // the exact id it will commit with — so the HITL card never names a run that
  // was never inserted (A4).
  const seedIdFloor = useMemo(
    () =>
      Number.parseInt(nextRunId(seedKeelRuns()).replace(/^RUN-/, ""), 10) - 1,
    [],
  );
  const runStartCountRef = useRef(0);

  // ONE ticker, started only while a run is actually running and torn down the
  // instant nothing is — an always-on interval is pure churn (§6.5). The
  // dependency is the boolean, so the interval is stable while runs keep
  // running and is cleared/restarted only on the running↔idle edge.
  const anyRunning = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => {
      setRuns((prev) => tick(prev, Date.now()));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  // THE one commit path every mutation shares, so the functional fast-path /
  // recompute guard cannot be gotten wrong by a future fifth mutation (the same
  // discipline `EngineMutationResult` enforces for the return type). It computes
  // `compute` against `runsRef` once, commits functionally, and returns the value
  // that COMMITTED where it can synchronously know it:
  //
  //   • It advances `runsRef` synchronously to this result BEFORE queuing the
  //     commit, so a sibling dispatched later in the SAME batch composes on this
  //     result rather than a pre-commit snapshot.
  //   • The updater writes `committed` with whichever branch actually lands —
  //     the fast path (`prev` is still the base we computed from ⇒ commit that
  //     result) or a recompute from the true-latest `prev` (another update
  //     slipped in ⇒ recompute so its progress on OTHER runs is not clobbered).
  //     The return prefers `committed`, falling back to `result` only when the
  //     updater was DEFERRED — React skips its eager-evaluation of the updater
  //     whenever the fiber's update queue is already non-empty.
  //
  // What this guarantees, precisely — stated at exactly its real strength, no
  // more (an overstated guarantee is what makes the next reader stop checking):
  //
  //   – STATE is correct UNCONDITIONALLY. The recompute branch always commits
  //     from the true-latest `prev`, so no update is ever lost or clobbered — a
  //     same-batch double-dispatch keeps the first update, a 900ms tick landing
  //     in the post-commit window keeps other runs' progress.
  //   – The RETURN is honest for the SAME-BATCH double-dispatch — the reachable
  //     defect this fix closes (covering test A5). There the deferral cause is a
  //     prior sibling in the same batch, and the synchronous mirror makes
  //     `base === prev`, so the fast path commits exactly the `result` we
  //     returned: a second approval the first already consumed is told `ok:false`,
  //     never a false success. When the updater is instead evaluated eagerly
  //     (empty queue — first-in-batch, or a cross-batch dispatch), `committed` is
  //     authoritative before we return.
  //
  // RESIDUAL — named, not hidden. A same-batch sibling is NOT the only way the
  // queue is non-empty. The 900ms ticker's `setRuns((prev) => tick(...))` queues
  // an update and schedules its render on a MessageChannel task; a browser input
  // event (the Approve click) can run BEFORE that render, so a mutation may
  // dispatch with the ticker's update still pending ⇒ no eager evaluation ⇒
  // `committed` is undefined ⇒ we return `result`. React then runs the ticker's
  // updater first (yielding ticked runs), so our updater sees `prev` = ticked
  // runs ≠ `base` (the pre-tick mirror) ⇒ the recompute branch runs and
  // `compute(prev)` can legitimately DISAGREE with the `result` already returned.
  // In that narrow window the returned ok/reason is BEST-EFFORT (a recompute may
  // contradict it); the COMMIT is still correct. It is reachable exactly when it
  // matters — the ticker only runs while a run is active, i.e. when approvals
  // happen. Closing it would require deferring the return until after commit,
  // which a synchronous API cannot do; do NOT "fix" it by dropping the recompute
  // branch — that trades a best-effort return for real state corruption.
  //
  // `compute` MUST be pure — every engine mutation is — because the recompute
  // branch may call it a second time, and React may double-invoke the updater in
  // dev (StrictMode); neither the counter nor any other state lives inside
  // `compute`/the updater, so both re-runs are idempotent. `runsRef` is written
  // here from event handlers (never during render), matching the ref convention.
  // Deps are empty (it only ever touches stable refs + the stable `setRuns`), so
  // it is referentially stable across the 900ms tick — which is what keeps the
  // four mutation callbacks below stable too.
  const commit = useCallback(
    <T extends EngineMutationResult>(compute: (prev: Run[]) => T): T => {
      const base = runsRef.current;
      const result = compute(base);
      // Advance the synchronous mirror so a same-batch sibling composes on THIS
      // result, not on the effect-synced (batch-lagging) previous value. NB: this
      // stores `result.runs` BEFORE the commit resolves, so if the recompute
      // branch below supersedes it the mirror briefly holds runs that NEVER
      // committed. Self-correcting for STATE — the post-commit effect re-syncs
      // `runsRef` to the true committed `runs`, and any later dispatch that reads
      // the stale mirror hits `prev !== base` ⇒ recompute — and it is the very
      // mechanism behind the ticker-deferral residual documented above.
      runsRef.current = result.runs;
      let committed: T | undefined;
      setRuns((prev) => {
        committed = prev === base ? result : compute(prev);
        return committed.runs;
      });
      return committed ?? result;
    },
    [],
  );

  const startRun = useCallback(
    (playbookId: string, input: StartRunInput): StartRunResult => {
      const pb = playbooks.find((p) => p.id === playbookId);
      if (!pb)
        return { ok: false, reason: `Unknown playbook "${playbookId}".` };
      // Mint the id from the monotonic counter and thread it through BOTH commit
      // branches, so the run named in this synchronous return is exactly the run
      // that commits — the fast-path and the recompute insert the SAME id, and a
      // sibling dispatch in the same batch already advanced the counter, so it
      // gets a different one. That is what closes A4 without a lost update.
      runStartCountRef.current += 1;
      const runId = `RUN-${seedIdFloor + runStartCountRef.current}`;
      const result = commit((prev) =>
        engineStartRun(prev, pb, input, personaRef.current.name, runId),
      );
      return { ok: result.ok, reason: result.reason, run: result.run };
    },
    [commit, playbooks, seedIdFloor],
  );

  const approveStep = useCallback(
    (runId: string, stepId: string, note?: string): MutationResult => {
      const result = commit((prev) =>
        engineApproveStep(prev, runId, stepId, personaRef.current, note),
      );
      return { ok: result.ok, reason: result.reason };
    },
    [commit],
  );

  const rejectStep = useCallback(
    (runId: string, stepId: string, note?: string): MutationResult => {
      const result = commit((prev) =>
        engineRejectStep(prev, runId, stepId, personaRef.current, note),
      );
      return { ok: result.ok, reason: result.reason };
    },
    [commit],
  );

  const cancelRun = useCallback(
    (runId: string): MutationResult => {
      const result = commit((prev) => engineCancelRun(prev, runId));
      return { ok: result.ok, reason: result.reason };
    },
    [commit],
  );

  // Reads reactive `runs` (not the post-commit ref), so render-time callers
  // (run-detail, tools.tsx showRun/approveStep) see the current commit's runs,
  // never a one-commit-stale mirror. Rebuilding per tick is free: it feeds the
  // KeelData memo, which already lists `runs` in its deps.
  const getRun = useCallback(
    (runId: string): Run | undefined => runs.find((r) => r.id === runId),
    [runs],
  );
  const getPlaybook = useCallback(
    (playbookId: string): Playbook | undefined =>
      playbooks.find((p) => p.id === playbookId),
    [playbooks],
  );

  const approvals = useMemo<ApprovalItem[]>(() => {
    const items: ApprovalItem[] = [];
    for (const run of runs) {
      if (run.status !== "blocked") continue;
      const step = run.steps.find((s) => s.status === "awaiting_approval");
      if (!step) continue;
      items.push({ run, step, actionable: step.approverRole === persona.role });
    }
    return items;
  }, [runs, persona.role]);

  const approvalsForMe = useMemo(
    () => approvals.filter((a) => a.actionable),
    [approvals],
  );

  const kpis = useMemo<KeelKpis>(() => {
    const openRuns = runs.filter(
      (r) =>
        r.status === "running" ||
        r.status === "blocked" ||
        r.status === "queued",
    ).length;
    const cycleTimes = runs
      .map(runCycleTimeMs)
      .filter((n): n is number => n !== null);
    return {
      openRuns,
      blockedRuns: runs.filter((r) => r.status === "blocked").length,
      completedRuns: runs.filter((r) => r.status === "completed").length,
      approvalsForMe: approvalsForMe.length,
      medianCycleTimeMs: cycleTimes.length > 0 ? median(cycleTimes) : null,
    };
  }, [runs, approvalsForMe]);

  // The churn guard (§6.5): a string keyed ONLY on (runId, status,
  // currentStepId) tuples — never on elapsed time or timestamps — so an
  // in-progress step's ticking clock does not invalidate the agent-context
  // readables that memoize on it.
  const summaryKey = useMemo(() => {
    return runs
      .map((r) => {
        const active = r.steps.find(
          (s) => s.status === "running" || s.status === "awaiting_approval",
        );
        const currentStepId =
          active?.id ?? r.steps[r.steps.length - 1]?.id ?? "";
        return `${r.id}:${r.status}:${currentStepId}`;
      })
      .join("|");
  }, [runs]);

  return useMemo<KeelData>(
    () => ({
      playbooks,
      runs,
      persona,
      getRun,
      getPlaybook,
      approvals,
      approvalsForMe,
      kpis,
      summaryKey,
      startRun,
      approveStep,
      rejectStep,
      cancelRun,
    }),
    [
      playbooks,
      runs,
      persona,
      getRun,
      getPlaybook,
      approvals,
      approvalsForMe,
      kpis,
      summaryKey,
      startRun,
      approveStep,
      rejectStep,
      cancelRun,
    ],
  );
}
