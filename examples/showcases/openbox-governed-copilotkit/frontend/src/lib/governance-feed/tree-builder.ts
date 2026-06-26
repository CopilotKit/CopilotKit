import { openBoxDemoScenarios } from "@/lib/openbox-demo-scenarios";
import { derivePillar } from "./pillars";
import type {
  ActionNode,
  FeedResultRecord,
  FeedStoreSnapshot,
  FeedTimingRecord,
  RunNode,
  StepNode,
} from "./types";

const SYNTHETIC_RUN_ID = "openbox-local-session";

function scenarioFor(action: string) {
  return openBoxDemoScenarios.find((item) => item.action === action);
}

function titleFor(action: string): string {
  return (
    scenarioFor(action)?.title ??
    (action ? action.replace(/_/g, " ") : "Governed Action")
  );
}

function runKey(record: FeedResultRecord): {
  id: string;
  synthetic: boolean;
} {
  if (record.runId) return { id: record.runId, synthetic: false };
  if (record.workflowId) return { id: record.workflowId, synthetic: false };
  return { id: SYNTHETIC_RUN_ID, synthetic: true };
}

function runLabel(id: string, synthetic: boolean): string {
  if (synthetic) return "Session (local)";
  return `Run ${id.slice(0, 8)}`;
}

function stepsForAction(
  action: string,
  timings: FeedTimingRecord[],
): StepNode[] {
  const matching = timings.filter((t) => t.action === action);
  // Collapse started/finished pairs by key: a finished record wins.
  const byKey = new Map<string, FeedTimingRecord>();
  for (const t of matching) {
    const existing = byKey.get(t.key);
    if (!existing || t.phase === "finished") byKey.set(t.key, t);
  }
  return Array.from(byKey.values())
    .sort(
      (a, b) =>
        a.arrivalIndex - b.arrivalIndex || a.startedAtMs - b.startedAtMs,
    )
    .map((t) => ({
      id: `${action}:${t.key}`,
      label: t.label,
      kind: t.timingKind,
      startedAtMs: t.startedAtMs,
      ms: t.ms,
      pending: t.phase === "started" && typeof t.ms !== "number",
    }));
}

function toActionNode(
  record: FeedResultRecord,
  timings: FeedTimingRecord[],
): ActionNode {
  const pillar = derivePillar(
    {
      verdict: record.verdict,
      redactionSummary: record.redactionSummary,
      hasGuardrailsSignal: record.hasGuardrailsSignal,
    },
    scenarioFor(record.action),
  );
  return {
    id: record.id,
    action: record.action,
    title: titleFor(record.action),
    request: record.request,
    verdict: record.verdict,
    pillar,
    reason: record.reason,
    redactionSummary: record.redactionSummary,
    riskScore: record.riskScore,
    trustTier: record.trustTier,
    isResume: record.isResume,
    steps: stepsForAction(record.action, timings),
    arrivalIndex: record.arrivalIndex,
    raw: record.raw,
  };
}

function orderByArrival<T extends { arrivalIndex: number }>(
  items: T[],
  secondary: (item: T) => number,
): T[] {
  return [...items].sort(
    (a, b) => a.arrivalIndex - b.arrivalIndex || secondary(a) - secondary(b),
  );
}

/**
 * Pure flat-records -> Run→Action→Step tree.
 *
 * Ordering caveat: no monotonic server sequence field exists client-side, so
 * order is synthesized from client arrival order (arrivalIndex) and then
 * emittedAt/startedAt timestamps. Concurrent same-millisecond events keep
 * arrival order.
 *
 * Approval->resume join: a resume result (isResume) whose approvalId matches
 * an earlier approval_required result is nested as that node's `continuation`
 * rather than appearing as a sibling.
 */
export function buildExecutionTree(snapshot: FeedStoreSnapshot): RunNode[] {
  const results = orderByArrival(snapshot.results, (r) => r.emittedAtMs);

  // Index resume continuations by approvalId.
  const resumesByApproval = new Map<string, FeedResultRecord>();
  for (const record of results) {
    if (record.isResume && record.approvalId) {
      resumesByApproval.set(record.approvalId, record);
    }
  }
  const consumedResumeIds = new Set<string>();

  const runs = new Map<string, RunNode>();
  let runArrival = 0;

  for (const record of results) {
    // Skip resume records that will be nested under their approval node.
    if (record.isResume && record.approvalId) {
      const approvalExists = results.some(
        (r) =>
          !r.isResume &&
          r.approvalId === record.approvalId &&
          r.verdict === "approval",
      );
      if (approvalExists) {
        consumedResumeIds.add(record.id);
        continue;
      }
    }

    const { id, synthetic } = runKey(record);
    let run = runs.get(id);
    if (!run) {
      run = {
        id,
        label: runLabel(id, synthetic),
        synthetic,
        actions: [],
        arrivalIndex: runArrival++,
      };
      runs.set(id, run);
    }

    const node = toActionNode(record, snapshot.timings);

    // Attach the resume continuation if this is the approval node.
    if (record.verdict === "approval" && record.approvalId) {
      const resume = resumesByApproval.get(record.approvalId);
      if (resume && !resume.isResume === false) {
        node.continuation = toActionNode(resume, snapshot.timings);
      }
    }

    run.actions.push(node);
  }

  // Final ordering of actions inside each run.
  const out = orderByArrival(Array.from(runs.values()), (r) => 0);
  for (const run of out) {
    run.actions = orderByArrival(run.actions, (a) => a.arrivalIndex);
  }
  // Mark consumed resumes as referenced (no-op guard for lint clarity).
  void consumedResumeIds;
  return out;
}
