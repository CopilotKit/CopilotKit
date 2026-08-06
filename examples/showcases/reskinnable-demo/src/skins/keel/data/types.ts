import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";

export type StepStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "done"
  | "failed";

export type RunStatus =
  | "queued"
  | "running"
  | "blocked"
  | "completed"
  | "cancelled";

/** Points a step at the corpus section that governs it. The keystone field. */
export interface PolicyRef {
  docId: string;
  sectionId: string;
  ref: string;
}

interface PlaybookStepBase {
  id: string;
  title: string;
  /** The team that performs this step, e.g. "HR Operations". */
  role: string;
  policyRef?: PolicyRef;
  /** How long the ticker takes to complete this step, in ms. */
  durationMs: number;
}

/**
 * A step that halts the run at an approval gate. `approverRole` is REQUIRED —
 * the engine matches it against a Persona.role to decide who may act, and the UI
 * derives actionability the same way. Making it mandatory here is what keeps the
 * two layers from ever disagreeing (an undefined approver would be approvable by
 * anyone in the engine yet actionable by no one in the UI, stranding the run).
 */
export interface ApprovalStep extends PlaybookStepBase {
  requiresApproval: true;
  /** Matched against Persona.role. */
  approverRole: string;
}

/** A step the ticker runs automatically. It has no approver by construction. */
export interface AutomaticStep extends PlaybookStepBase {
  requiresApproval: false;
  approverRole?: never;
}

/**
 * A discriminated union on `requiresApproval` so the invariant "a step that
 * requires approval MUST name an approverRole" is unrepresentable: the compiler
 * rejects `requiresApproval: true` without an `approverRole`, and forbids an
 * `approverRole` on a `requiresApproval: false` step.
 */
export type PlaybookStep = ApprovalStep | AutomaticStep;

export interface PlaybookInput {
  key: string;
  label: string;
}

export interface Playbook {
  id: string;
  title: string;
  summary: string;
  space: KnowledgeSpace;
  inputs: PlaybookInput[];
  steps: PlaybookStep[];
}

/**
 * A live step. An intersection (not `interface extends`) because `PlaybookStep`
 * is a union; the intersection distributes over it, preserving the discriminated
 * `requiresApproval`/`approverRole` correlation on run steps too.
 */
export type RunStep = PlaybookStep & {
  status: StepStatus;
  /** ISO timestamps. */
  startedAt?: string;
  completedAt?: string;
  approvedBy?: string;
  /** Set when a step was rejected — the persona who rejected it. Never implies approval. */
  rejectedBy?: string;
  note?: string;
};

export interface Run {
  /** e.g. "RUN-1043". */
  id: string;
  playbookId: string;
  title: string;
  /** Who or what the run is about, e.g. "Priya Raman — Radiology contractor". */
  subject: string;
  requestedBy: string;
  createdAt: string;
  status: RunStatus;
  steps: RunStep[];
  /** Playbook inputs captured at start, keyed by Playbook.inputs[].key. */
  inputs?: Record<string, string>;
}

/** A switchable demo persona. `role` is matched against step.approverRole. */
export interface Persona {
  id: string;
  name: string;
  role: string;
  unit: string;
}

export interface StartRunInput {
  subject: string;
  /** Keyed by Playbook.inputs[].key. */
  values?: Record<string, string>;
}

export interface MutationResult {
  ok: boolean;
  /** Present when ok is false — surfaced to the user AND returned to the agent. */
  reason?: string;
}

export interface StartRunResult extends MutationResult {
  run?: Run;
}

/**
 * The engine-side mutation convention: every pure mutation in `engine.ts`
 * reports `ok`/`reason` AND hands back the resulting run list, so a caller can
 * both surface a failure and commit the next state. Declared once so all
 * mutations share one contract — a future mutation that returns anything
 * narrower (e.g. a bare `Run[]`) cannot satisfy it, which is what keeps the
 * `ok`/`reason` convention from silently reappearing as a gap.
 */
export type EngineMutationResult = MutationResult & { runs: Run[] };

/** An approval gate, flagged for whether the current persona can act on it. */
export interface ApprovalItem {
  run: Run;
  step: RunStep;
  /** True when step.approverRole === current persona's role. */
  actionable: boolean;
}

export interface KeelKpis {
  openRuns: number;
  blockedRuns: number;
  completedRuns: number;
  approvalsForMe: number;
  /** null when fewer than one run has completed. */
  medianCycleTimeMs: number | null;
}

/**
 * The value `useKeelData()` returns and `useSkinData<KeelData>()` yields.
 * This is the interface every page, component, and tool codes against.
 */
export interface KeelData {
  playbooks: Playbook[];
  runs: Run[];
  persona: Persona;

  getRun: (runId: string) => Run | undefined;
  getPlaybook: (playbookId: string) => Playbook | undefined;

  approvals: ApprovalItem[];
  approvalsForMe: ApprovalItem[];
  kpis: KeelKpis;

  /**
   * A string that changes ONLY on a meaningful state transition — never on a
   * raw tick. Agent-context readables memoize on this to avoid churn.
   */
  summaryKey: string;

  startRun: (playbookId: string, input: StartRunInput) => StartRunResult;
  approveStep: (runId: string, stepId: string, note?: string) => MutationResult;
  rejectStep: (runId: string, stepId: string, note?: string) => MutationResult;
  cancelRun: (runId: string) => MutationResult;
}
