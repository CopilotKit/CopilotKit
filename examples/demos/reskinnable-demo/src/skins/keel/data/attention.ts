/**
 * What the register is asking the desk to LOOK AT — and the one figure in this
 * skin that can be genuinely unknown.
 *
 * ⚠️ "Unknown" is not `false`, `0`, or an empty list
 * (`.claude/skills/reskin/failure-modes.md` § 1). A document nobody has been
 * assigned to attest is NOT a document at 0% coverage and it is NOT a compliant
 * one — publishing either claim is the strongest statement this skin makes about
 * that row and the one it has least right to. A hospital register really does
 * contain such documents (a policy in draft has no audience yet), so the state
 * is reachable, not theoretical, and `procurement-thresholds` is seeded into it
 * on purpose.
 *
 * So coverage is a TRI-state, and the type is what makes forgetting the third
 * case a compile error rather than a rounding decision. Three wire forms, for
 * the three audiences that read it:
 *
 *  - the SCREEN gets `CoverageStatus` and must render unknown VISIBLY unknown —
 *    not green, not red, and not a bare "0%" in neutral ink either;
 *  - an agent READABLE gets `nullableCoverageShort` — `boolean | null`, never
 *    `false` for unknown, because a model cannot discount what you omitted and
 *    will restate your `false` as an all-clear, out loud;
 *  - a TALLY gets `unknown` as its own count, so a green `0` short cannot mean
 *    "we did not look", plus `coverageCaveat` returning the sentence or `null`
 *    off the SAME derivation, so the count and its caveat can never disagree.
 *
 * Server-safe: plain TypeScript, no React. The routes, the sandbox functions and
 * the pages all read this one module.
 */

import type { DocumentRecord } from "./types";

/** Coverage at or above this is "clear". Below it, the desk has work to do. */
export const COVERAGE_TARGET = 0.9;

export type CoverageStatus = "short" | "clear" | "unknown";

/**
 * The attention classes a register row can carry. NOT exclusive — POL-114 is
 * seeded carrying all three at once, which is both the honest reading of a real
 * register and what lets each lever value leave several rows.
 */
export const ATTENTION_CLASSES = [
  "review_overdue",
  "attestation_short",
  "unendorsed_revision",
] as const;

export type AttentionClass = (typeof ATTENTION_CLASSES)[number];

export const ATTENTION_LABELS: Record<AttentionClass, string> = {
  review_overdue: "Past review date",
  attestation_short: "Attestation short",
  unendorsed_revision: "Revision awaiting endorsement",
};

/**
 * Coverage as a ratio, or `null` when it cannot be measured.
 *
 * `assigned === 0` is the unknown case. A negative or non-finite pair is too:
 * the seed cannot produce one, but the record arrives over the wire through an
 * unvalidated cast on the client, so a shape nobody can compute with must
 * decline rather than divide.
 */
export function coverageRatio(record: DocumentRecord): number | null {
  const { assigned, completed } = record.attestation;
  if (!Number.isFinite(assigned) || !Number.isFinite(completed)) return null;
  if (assigned <= 0) return null;
  if (completed < 0) return null;
  return Math.min(1, completed / assigned);
}

export function coverageStatus(record: DocumentRecord): CoverageStatus {
  const ratio = coverageRatio(record);
  if (ratio === null) return "unknown";
  return ratio < COVERAGE_TARGET ? "short" : "clear";
}

/**
 * The readable/DTO form: `true` short, `false` clear, `null` unmeasurable.
 * NEVER `false` for unknown — see this file's header.
 */
export function nullableCoverageShort(record: DocumentRecord): boolean | null {
  const status = coverageStatus(record);
  return status === "unknown" ? null : status === "short";
}

/**
 * Coverage as the whole percent the beat-4 preference asks for, or `null`.
 *
 * Returned as a number rather than a string so the caller decides the suffix,
 * and `null` rather than `0` so a caller cannot print "0%" for "we did not
 * look". The rounding lives HERE rather than at each render site because the
 * agent quotes back whatever a readable holds: a strip showing "89%" beside a
 * readable holding 0.8887 gets narrated as "88.87%", which is the same KIND of
 * error as a row-count drift, one decimal place smaller.
 */
export function coveragePercent(record: DocumentRecord): number | null {
  const ratio = coverageRatio(record);
  return ratio === null ? null : Math.round(ratio * 100);
}

/** ISO date (YYYY-MM-DD) → epoch ms at UTC midnight, or NaN. */
const dayMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

/**
 * Past its scheduled review date.
 *
 * `now` is a parameter, never `Date.now()` read inside: the seed anchors every
 * date relative to the moment it is built, so a test that cannot inject the
 * clock is a test that passes today and fails on a leap second. An unparseable
 * date is NOT overdue — it is unknown, and an unknown that renders as a red flag
 * is the same lie as a `false` that renders as an all-clear.
 */
export function isReviewOverdue(record: DocumentRecord, now: number): boolean {
  const due = dayMs(record.reviewDue);
  return Number.isFinite(due) && due < now;
}

/** Days past the review date; negative = days remaining; null = unparseable. */
export function reviewDebtDays(
  record: DocumentRecord,
  now: number,
): number | null {
  const due = dayMs(record.reviewDue);
  if (!Number.isFinite(due)) return null;
  return Math.floor((now - due) / 86_400_000);
}

/** A revision is waiting and at least one required body has not endorsed it. */
export function hasUnendorsedRevision(record: DocumentRecord): boolean {
  return missingEndorsements(record).length > 0;
}

/**
 * The bodies that have not endorsed the pending revision, in list order.
 *
 * Exported because it is the SYMPTOM the release gate is allowed to state, and
 * both the gate and the register row must name the same bodies — two opinions
 * about who has not signed is a refusal the screen contradicts.
 */
export function missingEndorsements(record: DocumentRecord): string[] {
  const revision = record.pendingRevision;
  if (!revision) return [];
  return revision.requiredEndorsements
    .filter((endorsement) => !endorsement.endorsedAt)
    .map((endorsement) => endorsement.body);
}

/** Every attention class this row carries, in `ATTENTION_CLASSES` order. */
export function attentionClasses(
  record: DocumentRecord,
  now: number,
): AttentionClass[] {
  const classes: AttentionClass[] = [];
  if (isReviewOverdue(record, now)) classes.push("review_overdue");
  // `=== "short"` and not `!== "clear"`: an unmeasurable row is NOT short, and
  // filtering it into the short worklist would tell the desk we checked.
  if (coverageStatus(record) === "short") classes.push("attestation_short");
  if (hasUnendorsedRevision(record)) classes.push("unendorsed_revision");
  return classes;
}

export interface CoverageTally {
  short: number;
  clear: number;
  unknown: number;
}

export function tallyCoverage(records: DocumentRecord[]): CoverageTally {
  const tally: CoverageTally = { short: 0, clear: 0, unknown: 0 };
  for (const record of records) tally[coverageStatus(record)] += 1;
  return tally;
}

/**
 * The caveat sentence for an unmeasurable count, or `null` when there is
 * nothing to caveat. Derived from the SAME tally the figures are, so the two
 * can never disagree — a caveat that outlives the rows it described is a second
 * way to mislead the room.
 */
export function coverageCaveat(
  unknown: number,
  noun = "document",
): string | null {
  if (unknown <= 0) return null;
  const plural = unknown === 1 ? noun : `${noun}s`;
  return `${unknown} ${plural} have nobody assigned, so their attestation coverage is not measurable.`;
}

/**
 * Where an unmeasurable row sorts in a coverage-ordered worklist.
 *
 * Even the SORT has to place unknown somewhere EXPLICIT, or two surfaces will
 * each invent a different place for it. Short first (there is a real gap),
 * unknown second (somebody has to be assigned before there can be a gap), clear
 * last.
 */
export const COVERAGE_WORKLIST_RANK: Record<CoverageStatus, number> = {
  short: 0,
  unknown: 1,
  clear: 2,
};
