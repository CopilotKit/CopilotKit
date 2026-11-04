/**
 * In-memory, seed-built store for the Harbor Point Health desk.
 *
 * Seeded once at module init and rebuilt from the seed builders on `reset()`, so
 * mutations never bleed back into a shared literal. All mutations live for the
 * server process only; restarting the dev server resets to seed. Intentional
 * demo behaviour, and the same shape logistics/people/commerce use.
 *
 * TWO COLLECTIONS, TWO ORIGINS:
 *
 *  - `documents` is the policy REGISTER (`register-seed.ts`), built fresh from
 *    the corpus with dates anchored to the moment of the build.
 *  - `runs` mirrors the run engine's seed (`seed.ts`). The server still holds runs
 *    as STATE and advances them on no timer — but it is now the only clock:
 *    elapsed time is SETTLED ON READ by `src/app/api/keel/v1/settle-runs.ts`,
 *    which both `GET /ledger` and `GET /runs/[runId]` call before answering. The
 *    client ticker that used to live in `useKeelData` is gone; the provider's
 *    interval only re-fetches. The pure engine below is deliberately the SAME
 *    module every consumer uses, so nothing can disagree about what approving a
 *    step means.
 *
 * `playbooks` and `personas` are static modules rather than store state: nothing
 * in the demo mutates them, and a mutable copy would be a second opinion about
 * what a playbook is.
 */

import {
  approveStep as engineApproveStep,
  cancelRun as engineCancelRun,
  nextRunId,
  rejectStep as engineRejectStep,
  startRun as engineStartRun,
} from "./engine";
import { KEEL_PLAYBOOKS, seedKeelRuns } from "./seed";
import { seedRegister } from "./register-seed";
import { getPersona } from "./personas";
import {
  isOwnerNoticeTemplate,
  isReviewFlagReason,
  markNote,
} from "./handling";
import { isValidVarianceCode } from "./variance-codes";
import type {
  DocumentNote,
  DocumentRecord,
  ImpactBrief,
  OwnerNotice,
  Persona,
  Playbook,
  Run,
  StartRunInput,
  Variance,
} from "./types";

interface DB {
  documents: DocumentRecord[];
  runs: Run[];
  variances: Variance[];
  impactBriefs: ImpactBrief[];
}

const db: DB = {
  documents: seedRegister(),
  runs: seedKeelRuns(),
  // `variances` and `impactBriefs` have no seed and never will. A seeded
  // variance would be an unlock nobody filed, which is precisely the thing beat
  // 6 exists to demonstrate being filed; a seeded impact brief would be an
  // artifact with no document behind it, which is what beat 3d exists to
  // disprove.
  variances: [],
  impactBriefs: [],
};

let idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

/**
 * Put the desk back to the state the demo starts from.
 *
 * Rebuilt rather than deep-cloned, because both seeds anchor their dates to the
 * moment they are built: a clone of a module-load snapshot would drift further
 * from "today" with every hour the server stays up, and beat 3c's
 * `review_overdue` lever would slowly stop discriminating.
 *
 * Beat 5's three writes need no line of their own — `reviewFlag`, `ownerNotices`
 * and `notes` all live ON the document record and the seed carries none of them,
 * so rebuilding drops every one. Said out loud because the opposite is the
 * demo-destroying half: a register that opens with last run's 🚨 note already on
 * POL-121 makes the stored procedure look like it ran before anyone asked.
 */
export const reset = (): void => {
  db.documents = seedRegister();
  db.runs = seedKeelRuns();
  db.variances = [];
  db.impactBriefs = [];
  idCounter = 0;
};

// ---- Reads --------------------------------------------------------------
export const documents = (): DocumentRecord[] => db.documents;
export const runs = (): Run[] => db.runs;
export const variances = (): Variance[] => db.variances;
export const impactBriefs = (): ImpactBrief[] => db.impactBriefs;
export const playbooks = (): Playbook[] => KEEL_PLAYBOOKS;

export const findDocument = (docId: string): DocumentRecord | undefined =>
  db.documents.find((doc) => doc.docId === docId);
export const findRun = (runId: string): Run | undefined =>
  db.runs.find((run) => run.id === runId);
export const findVariance = (id: string): Variance | undefined =>
  db.variances.find((v) => v.id === id);
export const findPlaybook = (id: string): Playbook | undefined =>
  KEEL_PLAYBOOKS.find((pb) => pb.id === id);

/**
 * A policy reference reduced to what actually identifies it.
 *
 * Every caller of `findDocumentByRef` receives this string from a MODEL that
 * read it off a PDF whose headings are shouted, hyphenated inconsistently, or
 * spaced — so "pol-114", "POL 114" and "POL-114" are the same document, and an
 * exact `===` would call all three strangers. That is not cosmetic:
 * `POST /briefs` settles every cited revision against this lookup, so a ref that
 * fails to match silently turns a policy the library HAS carried for years into
 * "not in the library", and the agent announces it.
 */
const canonicalRef = (ref: string) =>
  ref
    .trim()
    .replace(/[\s_-]+/g, "")
    .toUpperCase();

/** Every policy ref the register carries, in register order. */
export const refsOnFile = (): string[] => db.documents.map((doc) => doc.ref);

export const findDocumentByRef = (ref: string): DocumentRecord | undefined => {
  const key = canonicalRef(ref);
  return db.documents.find((doc) => canonicalRef(doc.ref) === key);
};

// ---- Document mutations -------------------------------------------------

/**
 * BEAT 5, step 1 — raise the desk's review flag on a document.
 *
 * Throws code-like Errors the calling route maps to HTTP status.
 * `INVALID_REVIEW_REASON` is a CLOSED set, and it is closed for the OPPOSITE
 * reason to the variance catalogue: the agent is GIVEN this vocabulary (see
 * `handling.ts`), so a value outside it is a model error worth surfacing rather
 * than a discovery to be protected.
 */
export const raiseReviewFlag = (
  docId: string,
  reason: string,
  raisedBy: string,
): DocumentRecord => {
  const record = findDocument(docId);
  if (!record) throw new Error("NOT_FOUND");
  if (!isReviewFlagReason(reason)) throw new Error("INVALID_REVIEW_REASON");
  record.reviewFlag = {
    reason,
    since: new Date().toISOString(),
    raisedBy,
  };
  return record;
};

/** BEAT 5, step 2 — record a templated notice sent to the owning department. */
export const sendOwnerNotice = (
  docId: string,
  template: string,
  sentBy: string,
): OwnerNotice => {
  const record = findDocument(docId);
  if (!record) throw new Error("NOT_FOUND");
  if (!isOwnerNoticeTemplate(template)) throw new Error("INVALID_NOTICE");
  const notice: OwnerNotice = {
    id: nextId("on"),
    template,
    // Copied off the RECORD, never taken from the caller: the department on the
    // notice has to be the department that actually owns the document, and a
    // client-supplied name is a name the model spelled.
    owner: record.owner,
    sentBy,
    createdAt: new Date().toISOString(),
  };
  record.ownerNotices = [notice, ...(record.ownerNotices ?? [])];
  return notice;
};

/**
 * BEAT 5, step 3 — post a short note on the document record.
 *
 * The marker is forced by `markNote`, not requested from the caller: the point
 * of the note is that the room can SEE the record changed from the back of the
 * room, and a model that phrases it plainly would silently cost the beat its
 * only visible artifact on the register.
 */
export const addDocumentNote = (
  docId: string,
  text: string,
  author: string,
): DocumentNote => {
  const record = findDocument(docId);
  if (!record) throw new Error("NOT_FOUND");
  if (!text.trim()) throw new Error("EMPTY_NOTE");
  const note: DocumentNote = {
    id: nextId("dn"),
    text: markNote(text),
    author,
    createdAt: new Date().toISOString(),
  };
  record.notes = [note, ...(record.notes ?? [])];
  return note;
};

/** How long a freshly released revision runs before its next scheduled review. */
const REVIEW_CYCLE_DAYS = 365;

/**
 * Commit a release. The GATE IS NOT HERE — `checkReleaseAuthority` lives in
 * `release-authority.ts` and both routes that release call it explicitly, so
 * there is exactly one gate and a route that forgets it is a route whose test
 * goes red. This function is the raw mutation and assumes the verdict was taken.
 *
 * The pending revision BECOMES the effective one and is cleared: a register that
 * still showed "Rev D awaiting release" after releasing Rev D would leave the
 * room unable to tell whether anything happened. `releases` keeps the receipt,
 * newest first, and carries HOW it cleared — an audit trail that quietly forgot
 * a variance was involved would be the wrong record to keep.
 */
export const releaseRevision = (
  docId: string,
  releasedBy: string,
  via: "endorsed" | "variance",
  varianceId?: string,
): DocumentRecord => {
  const record = findDocument(docId);
  if (!record) throw new Error("NOT_FOUND");
  const revision = record.pendingRevision;
  if (!revision) throw new Error("NO_PENDING_REVISION");

  const now = Date.now();
  record.releases = [
    {
      revision: revision.label,
      releasedAt: new Date(now).toISOString(),
      releasedBy,
      via,
      ...(varianceId ? { varianceId } : {}),
    },
    ...(record.releases ?? []),
  ];
  record.effectiveRevision = revision.label;
  record.pendingRevision = undefined;
  record.status = "published";
  record.lastReviewed = new Date(now).toISOString().slice(0, 10);
  record.reviewDue = new Date(now + REVIEW_CYCLE_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return record;
};

// ---- Variances ----------------------------------------------------------

/**
 * File a DRAFT publication variance. Throws code-like Errors (`NOT_FOUND`,
 * `NO_PENDING_REVISION`, `INVALID_VARIANCE_CODE`) the calling route maps to
 * HTTP status.
 *
 * ⚠️ The route that reports `INVALID_VARIANCE_CODE` must NOT enumerate the
 * catalogue in its message. The closed set forces the agent to learn which code
 * works by watching the operator, which is the whole of beat 6; a 422 listing
 * the valid values hands it the answer through the fifth leak channel.
 */
export const fileVariance = (
  docId: string,
  code: string,
  rationale: string,
  filedBy: Persona,
): Variance => {
  const record = findDocument(docId);
  if (!record) throw new Error("NOT_FOUND");
  const revision = record.pendingRevision;
  if (!revision) throw new Error("NO_PENDING_REVISION");
  if (!isValidVarianceCode(code)) throw new Error("INVALID_VARIANCE_CODE");
  const variance: Variance = {
    id: nextId("var"),
    docId,
    // Copied off the record: a variance covers the revision that is actually
    // waiting, never a label the caller typed.
    revision: revision.label,
    code,
    status: "draft",
    rationale,
    filedBy: filedBy.name,
    role: filedBy.role,
    createdAt: new Date().toISOString(),
  };
  db.variances.push(variance);
  return variance;
};

/**
 * Ratify a draft variance (auto-ratify; there is no second review step in the
 * demo) and link it to its document's pending revision — which is what CAN lift
 * the release gate, PROVIDED the code is justifying (see release-authority.ts).
 *
 * A ratified decoy links exactly the same way and lifts nothing. That is the
 * demonstration working: the operator files under a plausible wrong code, the
 * release stays blocked, and the room watches the difference.
 */
export const ratifyVariance = (varianceId: string): Variance => {
  const variance = findVariance(varianceId);
  if (!variance) throw new Error("NOT_FOUND");
  if (variance.status !== "draft") throw new Error("ALREADY_RATIFIED");
  const record = findDocument(variance.docId);
  if (!record?.pendingRevision) throw new Error("NO_PENDING_REVISION");
  variance.status = "ratified";
  variance.ratifiedAt = new Date().toISOString();
  record.pendingRevision = {
    ...record.pendingRevision,
    activeVarianceId: variance.id,
  };
  return variance;
};

// ---- Beat 3d ------------------------------------------------------------

/**
 * File the durable impact brief. Newest first, like the release log.
 *
 * Nothing here references a thread, a run or a message: the record belongs to
 * the application, which is the entire claim the beat makes on stage.
 */
export const fileImpactBrief = (
  brief: Omit<ImpactBrief, "id" | "createdAt">,
): ImpactBrief => {
  const filed: ImpactBrief = {
    ...brief,
    id: nextId("ib"),
    createdAt: new Date().toISOString(),
  };
  db.impactBriefs.unshift(filed);
  return filed;
};

// ---- Runs ---------------------------------------------------------------
//
// Thin wrappers over the PURE engine the client hook uses, so "approve a step"
// means exactly one thing in this app. Each commits the engine's returned list
// and hands back its ok/reason verbatim.

export const startRun = (
  playbookId: string,
  input: StartRunInput,
  requestedBy: string,
): { ok: boolean; reason?: string; run?: Run } => {
  const playbook = findPlaybook(playbookId);
  if (!playbook) {
    return { ok: false, reason: `Unknown playbook "${playbookId}".` };
  }
  const result = engineStartRun(
    db.runs,
    playbook,
    input,
    requestedBy,
    nextRunId(db.runs),
  );
  db.runs = result.runs;
  return { ok: result.ok, reason: result.reason, run: result.run };
};

export const approveStep = (
  runId: string,
  stepId: string,
  personaId: string,
  note?: string,
): { ok: boolean; reason?: string; run?: Run } => {
  const result = engineApproveStep(
    db.runs,
    runId,
    stepId,
    getPersona(personaId),
    note,
  );
  db.runs = result.runs;
  return { ok: result.ok, reason: result.reason, run: findRun(runId) };
};

export const rejectStep = (
  runId: string,
  stepId: string,
  personaId: string,
  note?: string,
): { ok: boolean; reason?: string; run?: Run } => {
  const result = engineRejectStep(
    db.runs,
    runId,
    stepId,
    getPersona(personaId),
    note,
  );
  db.runs = result.runs;
  return { ok: result.ok, reason: result.reason, run: findRun(runId) };
};

export const cancelRun = (
  runId: string,
): { ok: boolean; reason?: string; run?: Run } => {
  const result = engineCancelRun(db.runs, runId);
  db.runs = result.runs;
  return { ok: result.ok, reason: result.reason, run: findRun(runId) };
};
