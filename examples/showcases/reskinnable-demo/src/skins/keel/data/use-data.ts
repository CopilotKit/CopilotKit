"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRole } from "@/skins/keel/role-context";
import type {
  ApprovalItem,
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

  // Refs let the mutation callbacks read the latest runs + persona WITHOUT being
  // rebuilt every 900ms tick, which would thrash every consumer's memoization.
  // Written in an effect (not during render) to satisfy react-hooks/refs, per
  // the repo convention in banking's tools.tsx. The callbacks only read these
  // from user events, which fire after commit, so post-render sync is correct.
  const runsRef = useRef(runs);
  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);
  const personaRef = useRef(persona);
  useEffect(() => {
    personaRef.current = persona;
  }, [persona]);

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

  const startRun = useCallback(
    (playbookId: string, input: StartRunInput): StartRunResult => {
      const pb = playbooks.find((p) => p.id === playbookId);
      if (!pb) return { ok: false, reason: `Unknown playbook "${playbookId}".` };
      const result = engineStartRun(
        runsRef.current,
        pb,
        input,
        personaRef.current.name,
      );
      setRuns(result.runs);
      return { ok: result.ok, reason: result.reason, run: result.run };
    },
    [playbooks],
  );

  const approveStep = useCallback(
    (runId: string, stepId: string, note?: string): MutationResult => {
      const result = engineApproveStep(
        runsRef.current,
        runId,
        stepId,
        personaRef.current,
        note,
      );
      setRuns(result.runs);
      return { ok: result.ok, reason: result.reason };
    },
    [],
  );

  const rejectStep = useCallback(
    (runId: string, stepId: string, note?: string): MutationResult => {
      const result = engineRejectStep(
        runsRef.current,
        runId,
        stepId,
        personaRef.current,
        note,
      );
      setRuns(result.runs);
      return { ok: result.ok, reason: result.reason };
    },
    [],
  );

  const cancelRun = useCallback((runId: string): void => {
    setRuns((prev) => engineCancelRun(prev, runId));
  }, []);

  const getRun = useCallback(
    (runId: string): Run | undefined =>
      runsRef.current.find((r) => r.id === runId),
    [],
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
