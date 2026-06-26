// Single source of truth for all Governance-Feed types. Defined once here and
// imported everywhere — never re-declared in another module.

/**
 * Feed badge vocabulary. Mirrors the SDK's OpenBoxUiVerdict
 * (note: 'approval', NOT 'require_approval') plus the spec's 5 verdicts.
 * The spec verdicts map onto these as:
 *   allow -> "allow", constrain/redact -> "constrain",
 *   require_approval -> "approval", block -> "block", halt -> "halt".
 * 'reviewing' is the pre-decision state; 'rejected'/'error' are terminal extras.
 */
export type GovernanceVerdict =
  | "reviewing"
  | "allow"
  | "constrain"
  | "approval"
  | "block"
  | "halt"
  | "rejected"
  | "error";

/** The three OpenBox "Authorize" pillars, plus an unknown fallback. */
export type GovernancePillar =
  | "guardrails"
  | "policies"
  | "behavioral_rules"
  | "unknown";

/**
 * A normalized governed tool-message result, as ingested into the store.
 * `raw` is the parsed OpenBoxCopilotActionResult record (kept for the JSON
 * viewer). `arrivalIndex` is a monotonic client-side counter used to
 * synthesize ordering (no server sequence field exists client-side).
 */
export interface FeedResultRecord {
  kind: "result";
  /** tool_call_id of the originating governed tool call (stable id). */
  id: string;
  action: string;
  request: string;
  verdict: GovernanceVerdict;
  status: string;
  reason: string;
  message: string;
  redactionSummary?: string;
  hasGuardrailsSignal: boolean;
  riskScore?: number;
  trustTier?: string | number;
  runId?: string;
  workflowId?: string;
  activityId?: string;
  approvalId?: string;
  governanceEventId?: string;
  /** True when this result is a resume continuation (resume tool call). */
  isResume: boolean;
  arrivalIndex: number;
  emittedAtMs: number;
  raw: Record<string, unknown>;
}

/** A timing sub-step record (one per timing.v1 event), keyed by action+key. */
export interface FeedTimingRecord {
  kind: "timing";
  action: string;
  request: string;
  key: string;
  label: string;
  timingKind: string;
  phase: "started" | "finished";
  startedAtMs: number;
  ms?: number;
  arrivalIndex: number;
}

/** Append-only store snapshot consumed by the pure tree-builder. */
export interface FeedStoreSnapshot {
  results: FeedResultRecord[];
  timings: FeedTimingRecord[];
  halted: boolean;
  haltedAtMs?: number;
  /** Bumped on every mutation so useSyncExternalStore re-renders. */
  revision: number;
}

/** Level 3 — timing sub-step. */
export interface StepNode {
  id: string;
  label: string;
  kind: string;
  startedAtMs: number;
  ms?: number;
  /** True while the step has started but not finished. */
  pending: boolean;
}

/** Level 2 — one governed Action (one per governed tool-message result). */
export interface ActionNode {
  id: string;
  action: string;
  title: string;
  request: string;
  verdict: GovernanceVerdict;
  pillar: GovernancePillar;
  reason: string;
  redactionSummary?: string;
  riskScore?: number;
  trustTier?: string | number;
  isResume: boolean;
  /** A resume continuation joined to this action (approval -> resume). */
  continuation?: ActionNode;
  steps: StepNode[];
  arrivalIndex: number;
  raw: Record<string, unknown>;
}

/** Level 1 — Run / Session. */
export interface RunNode {
  id: string;
  /** Display label, e.g. "Run a1b2c3d4" or "Session (local)". */
  label: string;
  /** True when id is a synthetic fallback (no runId/workflowId present). */
  synthetic: boolean;
  actions: ActionNode[];
  arrivalIndex: number;
}
