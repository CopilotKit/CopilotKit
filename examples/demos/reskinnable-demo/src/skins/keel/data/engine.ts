import type {
  EngineMutationResult,
  Persona,
  Playbook,
  Run,
  RunStatus,
  RunStep,
  StartRunInput,
  StartRunResult,
  StepStatus,
} from "./types";

/** Seeds end at RUN-1044, so the next allocated id is RUN-1045. */
const SEED_ID_FLOOR = 1044;

/**
 * The next free `RUN-N` id for this list. Exported so the hook can seed its
 * monotonic id counter from the initial seed runs; from there the hook mints
 * ids synchronously and passes them to `startRun` as `preferredId`, which is
 * what lets the run named in a mutation's synchronous return be the run that
 * actually commits (see A4) while distinct dispatches stay unique.
 */
export function nextRunId(runs: Run[]): string {
  const max = runs.reduce((acc, run) => {
    const n = Number.parseInt(run.id.replace(/^RUN-/, ""), 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, SEED_ID_FLOOR);
  return `RUN-${max + 1}`;
}

/**
 * Start the next `pending` step. If it needs approval it becomes
 * `awaiting_approval` and the run `blocked`; otherwise it starts and the run is
 * `running`. No pending step left ⇒ the run is `completed`.
 */
function startNextStep(
  steps: RunStep[],
  now: number,
): { steps: RunStep[]; status: RunStatus } {
  const nextIndex = steps.findIndex((s) => s.status === "pending");
  if (nextIndex === -1) return { steps, status: "completed" };

  const next = steps[nextIndex];
  if (next.requiresApproval) {
    // A gate becomes active the moment it starts awaiting approval, so it must
    // carry startedAt for the whole awaiting_approval -> done/failed path —
    // matching what the seed does and what running steps get below.
    return {
      steps: steps.map((s, i) =>
        i === nextIndex
          ? {
              ...s,
              status: "awaiting_approval" as StepStatus,
              startedAt: new Date(now).toISOString(),
            }
          : s,
      ),
      status: "blocked",
    };
  }
  return {
    steps: steps.map((s, i) =>
      i === nextIndex
        ? {
            ...s,
            status: "running" as StepStatus,
            startedAt: new Date(now).toISOString(),
          }
        : s,
    ),
    status: "running",
  };
}

function advanceRun(run: Run, now: number): Run {
  let steps = run.steps;
  let status: RunStatus = run.status;
  let mutated = false;

  // Complete every step whose elapsed time exceeds its duration, advancing one
  // step at a time. Terminates because a freshly-started step has
  // startedAt === now (elapsed 0), which fails the elapsed check below.
  while (true) {
    const idx = steps.findIndex((s) => s.status === "running");
    if (idx === -1) break;
    const running = steps[idx];
    const startedMs = running.startedAt ? Date.parse(running.startedAt) : now;
    if (now - startedMs <= running.durationMs) break;

    steps = steps.map((s, i) =>
      i === idx
        ? {
            ...s,
            status: "done" as StepStatus,
            completedAt: new Date(now).toISOString(),
          }
        : s,
    );
    const advanced = startNextStep(steps, now);
    steps = advanced.steps;
    status = advanced.status;
    mutated = true;
    if (status !== "running") break;
  }

  return mutated ? { ...run, steps, status } : run;
}

export function tick(runs: Run[], now: number): Run[] {
  let changed = false;
  const next = runs.map((run) => {
    if (run.status !== "running") return run;
    const advanced = advanceRun(run, now);
    if (advanced !== run) changed = true;
    return advanced;
  });
  // Same reference when nothing moved: a React setState with it bails out, so
  // the 900ms ticker causes no re-render on an idle frame (§6.5).
  return changed ? next : runs;
}

export function startRun(
  runs: Run[],
  playbook: Playbook,
  input: StartRunInput,
  requestedBy: string,
  /**
   * The id this run must carry, minted by the caller BEFORE it commits so the
   * run named in the caller's synchronous return is the run that actually lands
   * — both the fast-path and the recompute branch insert THIS id. Omitted only
   * by standalone callers (e.g. unit tests), which fall back to `nextRunId`. The
   * hook mints these from a monotonic counter, so distinct dispatches always get
   * distinct ids; this function honours whatever it is given verbatim.
   */
  preferredId?: string,
): StartRunResult & { runs: Run[] } {
  const nowIso = new Date().toISOString();
  const firstBlocks = playbook.steps[0]?.requiresApproval ?? false;
  const id = preferredId ?? nextRunId(runs);

  const steps: RunStep[] = playbook.steps.map((step, i) => {
    if (i !== 0) return { ...step, status: "pending" as StepStatus };
    // Whether the first step gates or runs, it becomes active now — so both
    // branches stamp startedAt (a gate keeps it through awaiting_approval).
    return firstBlocks
      ? {
          ...step,
          status: "awaiting_approval" as StepStatus,
          startedAt: nowIso,
        }
      : { ...step, status: "running" as StepStatus, startedAt: nowIso };
  });

  const run: Run = {
    id,
    playbookId: playbook.id,
    title: playbook.title,
    subject: input.subject,
    requestedBy,
    createdAt: nowIso,
    status: firstBlocks ? "blocked" : "running",
    steps,
    inputs: input.values,
  };

  return { ok: true, run, runs: [run, ...runs] };
}

/** Validate that a step is an actionable gate for this approver, or explain why not. */
function findGate(
  runs: Run[],
  runId: string,
  stepId: string,
  approver: Persona,
): { ok: false; reason: string } | { ok: true; run: Run; step: RunStep } {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { ok: false, reason: `Run ${runId} was not found.` };
  if (run.status === "completed" || run.status === "cancelled") {
    return {
      ok: false,
      reason: `Run ${runId} is ${run.status} and can no longer be actioned.`,
    };
  }
  const step = run.steps.find((s) => s.id === stepId);
  if (!step) {
    return {
      ok: false,
      reason: `Step ${stepId} was not found on run ${runId}.`,
    };
  }
  if (step.status !== "awaiting_approval") {
    return {
      ok: false,
      reason: `Step "${step.title}" is ${step.status}, not awaiting approval — it may have already advanced.`,
    };
  }
  // The type makes this unrepresentable (an ApprovalStep always names an
  // approverRole), but guard at runtime anyway so a gate that somehow reached
  // here without one is refused rather than approvable-by-anyone — matching the
  // UI, which finds no persona actionable for it. The two layers must agree.
  if (!step.approverRole) {
    return {
      ok: false,
      reason: `Step "${step.title}" requires approval but names no approver role, so it cannot be actioned.`,
    };
  }
  if (step.approverRole !== approver.role) {
    return {
      ok: false,
      reason: `This step requires ${step.approverRole}; you are acting as ${approver.role}.`,
    };
  }
  return { ok: true, run, step };
}

export function approveStep(
  runs: Run[],
  runId: string,
  stepId: string,
  approver: Persona,
  note?: string,
): EngineMutationResult {
  const gate = findGate(runs, runId, stepId, approver);
  if (!gate.ok) return { ok: false, reason: gate.reason, runs };

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const approvedSteps = gate.run.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: "done" as StepStatus,
          completedAt: nowIso,
          approvedBy: approver.name,
          note,
        }
      : s,
  );
  const advanced = startNextStep(approvedSteps, nowMs);
  const updated: Run = {
    ...gate.run,
    steps: advanced.steps,
    status: advanced.status,
  };
  return { ok: true, runs: runs.map((r) => (r.id === runId ? updated : r)) };
}

export function rejectStep(
  runs: Run[],
  runId: string,
  stepId: string,
  approver: Persona,
  note?: string,
): EngineMutationResult {
  const gate = findGate(runs, runId, stepId, approver);
  if (!gate.ok) return { ok: false, reason: gate.reason, runs };

  const nowIso = new Date().toISOString();
  const steps = gate.run.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: "failed" as StepStatus,
          completedAt: nowIso,
          rejectedBy: approver.name,
          note,
        }
      : s,
  );
  const updated: Run = { ...gate.run, steps, status: "cancelled" };
  return { ok: true, runs: runs.map((r) => (r.id === runId ? updated : r)) };
}

export function cancelRun(runs: Run[], runId: string): EngineMutationResult {
  const run = runs.find((r) => r.id === runId);
  if (!run) return { ok: false, reason: `Run ${runId} was not found.`, runs };
  if (run.status === "completed" || run.status === "cancelled") {
    return {
      ok: false,
      reason: `Run ${runId} is ${run.status} and can no longer be cancelled.`,
      runs,
    };
  }
  return {
    ok: true,
    runs: runs.map((r) =>
      r.id === runId ? { ...r, status: "cancelled" as RunStatus } : r,
    ),
  };
}
