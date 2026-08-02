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

export interface PlaybookStep {
  id: string;
  title: string;
  /** The team that performs this step, e.g. "HR Operations". */
  role: string;
  requiresApproval: boolean;
  /** Required whenever requiresApproval is true. Matched against Persona.role. */
  approverRole?: string;
  policyRef?: PolicyRef;
  /** How long the ticker takes to complete this step, in ms. */
  durationMs: number;
}

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

export interface RunStep extends PlaybookStep {
  status: StepStatus;
  /** ISO timestamps. */
  startedAt?: string;
  completedAt?: string;
  approvedBy?: string;
  note?: string;
}

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
  cancelRun: (runId: string) => void;
}
