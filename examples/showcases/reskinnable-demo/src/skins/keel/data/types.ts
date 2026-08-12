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
 * ⚠️ HISTORICAL — the value the deleted `useKeelData()` returned via
 * `useSkinData<KeelData>()`. It is no longer what anything codes against, and it
 * is no longer REFERENCED by any code: `useKeelDesk()` (`../desk-data.ts`)
 * replaced it, whose read half is structurally this minus the synchronous
 * mutators (every write is now an HTTP POST + re-read, so those return promises).
 *
 * Kept because several comments across the skin describe the migration in terms of
 * this shape, and because it is the clearest single statement of what the desk owes
 * its consumers. Do NOT add a consumer: `useSkinData<KeelData>()` returns
 * `undefined` for keel, exactly as it does for every other skin.
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

/* ==========================================================================
 * THE REST SUBSTRATE — the policy register
 * ==========================================================================
 *
 * ONE SUBSTRATE, as of the beat-parity work. Everything in this file — the run
 * engine's shapes above, the register's below — is served by
 * `src/app/api/keel/v1/**` and read through a single `GET /ledger` snapshot
 * (`../ledger-context.tsx` → `../desk-data.ts`).
 *
 * The types above once belonged to a SECOND, client-side substrate: `useKeelData`
 * held runs in `useState` and advanced them on a 900 ms `setInterval` while the
 * server held them as state only. That is gone, and so is the split this banner
 * used to announce as "deliberately not merged yet". Runs are settled SERVER-side
 * on every read (`src/app/api/keel/v1/settle-runs.ts`, called by both
 * `GET /ledger` and `GET /runs/[runId]`), and the client interval only re-fetches
 * — the deleted ticker was a second clock that painted progress the server had
 * never heard of, which the next re-read after any write silently rewound.
 *
 * The pure engine (`./engine.ts`) is still the SAME module the server route uses,
 * which is why approving a step means exactly one thing.
 *
 * WHY THE CORPUS IS NOT IN HERE. `knowledge/corpus.ts` supplies a document's
 * WORDS: prose that changes only when an author edits the module. The register
 * below supplies the same document's LIFECYCLE: review dates, attestation
 * coverage, which revision the workforce is reading, and which revision is
 * waiting to go out. `GET /api/keel/v1/documents/<docId>` joins them and returns
 * `{ doc, record }`, which is how `knowledge/<docId>` is served without the
 * corpus becoming mutable state or the register duplicating prose.
 */

/** Where a document sits in the register. Derived nowhere — stored. */
export type RegisterStatus = "draft" | "in_review" | "published";

/** Where a REVISION of a document sits. */
export type RevisionStage = "draft" | "endorsed" | "released";

/**
 * One governing body that must sign a revision off before it may be released.
 * `endorsedAt` absent = has NOT endorsed; that absence is the whole gate.
 */
export interface Endorsement {
  /** e.g. "Policy Governance Committee". */
  body: string;
  endorsedAt?: string;
  endorsedBy?: string;
}

/**
 * A revision waiting to go to the workforce — beat 6's subject.
 *
 * `requiredEndorsements` is a LIST rather than a boolean so the refusal can name
 * WHICH body has not signed. That is the symptom the gate is allowed to state;
 * anything about how to get past it is not (see `data/variance-codes.ts`).
 */
export interface Revision {
  /** e.g. "Rev D". */
  label: string;
  stage: RevisionStage;
  summary: string;
  authoredBy: string;
  requiredEndorsements: Endorsement[];
  /** Set by `ratifyVariance`. This is what can lift the release gate. */
  activeVarianceId?: string;
}

/** How many people the document is assigned to, and how many have attested. */
export interface Attestation {
  assigned: number;
  completed: number;
}

/** BEAT 5, step 1 — the desk's review flag. Absent until raised. */
export interface ReviewFlag {
  /** A `ReviewFlagReason` from `data/handling.ts`; stored as a string. */
  reason: string;
  since: string;
  raisedBy: string;
}

/** BEAT 5, step 2 — a templated notice sent to the owning department. */
export interface OwnerNotice {
  id: string;
  /** An `OwnerNoticeTemplate` from `data/handling.ts`. */
  template: string;
  /** The owning department as the register spells it, copied off the record. */
  owner: string;
  sentBy: string;
  createdAt: string;
}

/** BEAT 5, step 3 — a short note on the record, newest first. */
export interface DocumentNote {
  id: string;
  /** Always carries `NOTE_MARKER` — the store forces it. */
  text: string;
  author: string;
  createdAt: string;
}

/** One release that actually happened, newest first. The visible receipt. */
export interface ReleaseEntry {
  revision: string;
  releasedAt: string;
  releasedBy: string;
  /** How the release cleared the gate. `"variance"` names the variance id. */
  via: "endorsed" | "variance";
  varianceId?: string;
}

/**
 * The register row for ONE corpus document.
 *
 * `docId` joins to `KEEL_CORPUS`; `ref`, `title`, `space` and `owner` are copied
 * from it at seed time so a register row is self-describing on the wire (an
 * agent readable and a sandbox function both need the ref without a second
 * lookup). `data/register-seed.ts` DERIVES all four from the corpus rather than
 * restating them, and its test fails if the two ever disagree — two hand-written
 * lists with no drift guard is how a register ends up citing a policy number the
 * library does not carry.
 */
export interface DocumentRecord {
  docId: string;
  ref: string;
  title: string;
  space: KnowledgeSpace;
  owner: string;
  status: RegisterStatus;
  /** The revision the workforce is reading today. Absent on a pure draft. */
  effectiveRevision?: string;
  /** ISO date (YYYY-MM-DD). */
  lastReviewed: string;
  /** ISO date (YYYY-MM-DD). Past = review-overdue. */
  reviewDue: string;
  attestation: Attestation;
  /** The revision awaiting release, if any. Beat 6 and beat 3a both act on it. */
  pendingRevision?: Revision;
  releases?: ReleaseEntry[];
  reviewFlag?: ReviewFlag;
  ownerNotices?: OwnerNotice[];
  notes?: DocumentNote[];
}

/**
 * A publication variance — the unlock path for beat 6's gate.
 *
 * Filed as a `draft`, then ratified. Ratifying links it to the document's
 * pending revision; whether it actually LIFTS the gate depends on its code
 * being justifying, which `data/variance-codes.ts` decides and never publishes
 * to the agent.
 */
export interface Variance {
  id: string;
  docId: string;
  /** The revision label this variance covers, copied off the record. */
  revision: string;
  code: string;
  status: "draft" | "ratified";
  rationale: string;
  filedBy: string;
  role: string;
  createdAt: string;
  ratifiedAt?: string;
}

/**
 * BEAT 3d — the DURABLE artifact, filed from an ingested regulatory bulletin.
 *
 * Deliberately not a run, not a note and not the canvas ops report. The ops
 * report is a RENDER: it lives as long as the canvas shows it and dies with the
 * thread. This record is the opposite claim — delete the whole thread and it is
 * still here, because it belongs to the application.
 */
export interface ImpactBrief {
  id: string;
  /** The issuing body as the DOCUMENT names it, carried across verbatim. */
  source: string;
  /** The corpus space the bulletin covers. */
  space: KnowledgeSpace;
  /** The effective date the DOCUMENT states, carried across verbatim. */
  effective: string;
  summary: string;
  citations: ImpactBriefCitation[];
  /** At most three short consequences the desk should act on. */
  impacts: string[];
  filedBy: string;
  role: string;
  createdAt: string;
}

/**
 * One policy the bulletin touches.
 *
 * The fields are split by WHO OWNS THE FACT, which is the whole lesson of
 * demo-beats.md's `oldRateUsdPerKg` note:
 *
 *  - `ref`, `title` and `requiredAction` come from the DOCUMENT. Only a reader
 *    of the attachment knows them, and that is the beat's proof — model-authored.
 *  - `currentRevision` is a REGISTER fact. `POST /briefs` SETTLES it: overwritten
 *    from the register on a ref match, and DROPPED when the library carries no
 *    such ref (the absence of the row IS the answer). Never `??`-merged, which
 *    repairs the under-filled case and stores the wrong one.
 */
export interface ImpactBriefCitation {
  ref: string;
  title: string;
  currentRevision?: string;
  requiredAction: string;
}

/**
 * The one snapshot read. Every REST-backed skin in this app uses a single
 * ledger fetch rather than many chatty reads, so a page mounts with one request
 * and the readables all describe the same instant.
 */
export interface KeelLedger {
  documents: DocumentRecord[];
  runs: Run[];
  playbooks: Playbook[];
  personas: Persona[];
  variances: Variance[];
  impactBriefs: ImpactBrief[];
  /** ISO timestamp the snapshot was taken. */
  asOf: string;
}
