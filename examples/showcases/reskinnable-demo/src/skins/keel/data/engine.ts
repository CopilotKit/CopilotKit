import type {
  MutationResult,
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

function nextRunId(runs: Run[]): string {
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
    return {
      steps: steps.map((s, i) =>
        i === nextIndex
          ? { ...s, status: "awaiting_approval" as StepStatus }
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
): StartRunResult & { runs: Run[] } {
  const nowIso = new Date().toISOString();
  const firstBlocks = playbook.steps[0]?.requiresApproval ?? false;

  const steps: RunStep[] = playbook.steps.map((step, i) => {
    if (i !== 0) return { ...step, status: "pending" as StepStatus };
    return firstBlocks
      ? { ...step, status: "awaiting_approval" as StepStatus }
      : { ...step, status: "running" as StepStatus, startedAt: nowIso };
  });

  const run: Run = {
    id: nextRunId(runs),
    playbookId: playbook.id,
    title: playbook.title,
    subject: input.subject,
    requestedBy,
    createdAt: nowIso,
    status: firstBlocks ? "blocked" : "running",
    steps,
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
    return { ok: false, reason: `Step ${stepId} was not found on run ${runId}.` };
  }
  if (step.status !== "awaiting_approval") {
    return {
      ok: false,
      reason: `Step "${step.title}" is ${step.status}, not awaiting approval — it may have already advanced.`,
    };
  }
  if (step.approverRole && step.approverRole !== approver.role) {
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
): MutationResult & { runs: Run[] } {
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
): MutationResult & { runs: Run[] } {
  const gate = findGate(runs, runId, stepId, approver);
  if (!gate.ok) return { ok: false, reason: gate.reason, runs };

  const nowIso = new Date().toISOString();
  const steps = gate.run.steps.map((s) =>
    s.id === stepId
      ? {
          ...s,
          status: "failed" as StepStatus,
          completedAt: nowIso,
          approvedBy: approver.name,
          note,
        }
      : s,
  );
  const updated: Run = { ...gate.run, steps, status: "cancelled" };
  return { ok: true, runs: runs.map((r) => (r.id === runId ? updated : r)) };
}

export function cancelRun(runs: Run[], runId: string): Run[] {
  return runs.map((run) =>
    run.id === runId &&
    run.status !== "completed" &&
    run.status !== "cancelled"
      ? { ...run, status: "cancelled" }
      : run,
  );
}
