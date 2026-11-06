/**
 * BEATS 1 and 4 — the two derived views of the register.
 *
 * BEAT 1 wants tiles and a chart from live data as the answer to the FIRST pill,
 * so `deriveRegisterKpis` publishes the four figures the strip renders. It
 * exists as an exported function rather than as arithmetic inside a component
 * because the on-screen readable has to quote the SAME numbers the strip paints:
 * a strip rounding coverage to "89%" beside a readable holding the raw ratio
 * gets narrated back as "88.87%", which is a small drift and exactly the kind of
 * error this beat cannot survive. One derivation, two consumers.
 *
 * BEAT 4 wants the answer to obey a seeded reading preference AND to be seen
 * obeying it. The preference is:
 *
 *   group by knowledge space; lead each group with anything past its review
 *   date; give attestation coverage as a WHOLE PERCENT, never a fraction; name
 *   the owning department beside every ref; and SAY when coverage is not
 *   measurable rather than printing 0%.
 *
 * `summarizeRegister` is the shape that satisfies all five, and the last clause
 * is not decoration: obeying the preference and telling the truth are the same
 * code path here, because a document with nobody assigned has UNKNOWN coverage
 * and the tri-state in `attention.ts` is what stops it being published as 0%.
 *
 * Server-safe: plain TypeScript, no React.
 */

import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";
import {
  coverageCaveat,
  coveragePercent,
  isReviewOverdue,
  hasUnendorsedRevision,
  reviewDebtDays,
  tallyCoverage,
} from "./attention";
import type { CoverageTally } from "./attention";
import type { DocumentRecord } from "./types";

export interface RegisterKpis {
  /** Documents with a revision in force. A pure draft is not "in force". */
  inForce: number;
  /** Past their scheduled review date. */
  pastReview: number;
  /**
   * Attestation coverage across every MEASURABLE document, as a whole percent —
   * `null` when nothing is measurable at all, never 0. Weighted by assignment
   * count rather than averaged per document: an unweighted mean lets a 12-person
   * policy at 50% drag a 1,240-person policy at 100%, and the figure the room is
   * asked to read as "how much of the workforce has attested" would not be that
   * at all.
   */
  coveragePercent: number | null;
  /** Documents whose coverage cannot be measured — its own count, never folded. */
  coverageUnknown: number;
  /** Revisions waiting to go to the workforce. */
  awaitingRelease: number;
  /** Of those, how many are blocked on an endorsement. */
  unendorsed: number;
}

export function deriveRegisterKpis(
  records: DocumentRecord[],
  now: number,
): RegisterKpis {
  let assigned = 0;
  let completed = 0;
  let unknown = 0;
  for (const record of records) {
    if (coveragePercent(record) === null) {
      unknown += 1;
      continue;
    }
    assigned += record.attestation.assigned;
    completed += Math.min(
      record.attestation.completed,
      record.attestation.assigned,
    );
  }
  return {
    inForce: records.filter((r) => Boolean(r.effectiveRevision)).length,
    pastReview: records.filter((r) => isReviewOverdue(r, now)).length,
    coveragePercent:
      assigned > 0 ? Math.round((completed / assigned) * 100) : null,
    coverageUnknown: unknown,
    awaitingRelease: records.filter((r) => Boolean(r.pendingRevision)).length,
    unendorsed: records.filter(hasUnendorsedRevision).length,
  };
}

/** One document as the beat-4 summary prints it. */
export interface SummaryRow {
  ref: string;
  title: string;
  /** The owning department — the preference asks for it beside every ref. */
  owner: string;
  status: DocumentRecord["status"];
  /** Whole percent, or `null` when coverage is not measurable. Never 0-for-unknown. */
  coveragePercent: number | null;
  overdue: boolean;
  /** Days past the review date; negative = days remaining; null = unparseable. */
  reviewDebtDays: number | null;
}

export interface SummaryGroup {
  space: KnowledgeSpace;
  rows: SummaryRow[];
  /** Rows in this group that are past their review date. */
  overdue: number;
  coverage: CoverageTally;
  /** The unmeasurable-coverage sentence for THIS group, or null. */
  caveat: string | null;
}

export interface RegisterSummary {
  groups: SummaryGroup[];
  kpis: RegisterKpis;
  /** The unmeasurable-coverage sentence across the whole register, or null. */
  caveat: string | null;
}

/** Space order is the corpus's own, so the summary reads the same way every time. */
const SPACE_ORDER: KnowledgeSpace[] = ["privacy", "clinical", "vendor"];

/**
 * Group by space, overdue first within each group, then by how far past due.
 *
 * The ordering is part of the PREFERENCE, not a display nicety — "lead with
 * anything past its review date" is a claim the room can check by looking, and
 * it is the reason the beat is visible at all. Ties break on ref so the same
 * register always summarizes identically.
 */
export function summarizeRegister(
  records: DocumentRecord[],
  now: number,
): RegisterSummary {
  const groups: SummaryGroup[] = [];
  for (const space of SPACE_ORDER) {
    const inSpace = records.filter((record) => record.space === space);
    if (inSpace.length === 0) continue;
    const rows = [...inSpace]
      .sort((a, b) => {
        const overdue =
          Number(isReviewOverdue(b, now)) - Number(isReviewOverdue(a, now));
        if (overdue !== 0) return overdue;
        const debt =
          (reviewDebtDays(b, now) ?? 0) - (reviewDebtDays(a, now) ?? 0);
        return debt !== 0 ? debt : a.ref.localeCompare(b.ref);
      })
      .map<SummaryRow>((record) => ({
        ref: record.ref,
        title: record.title,
        owner: record.owner,
        status: record.status,
        coveragePercent: coveragePercent(record),
        overdue: isReviewOverdue(record, now),
        reviewDebtDays: reviewDebtDays(record, now),
      }));
    const coverage = tallyCoverage(inSpace);
    groups.push({
      space,
      rows,
      overdue: rows.filter((row) => row.overdue).length,
      coverage,
      caveat: coverageCaveat(coverage.unknown),
    });
  }
  return {
    groups,
    kpis: deriveRegisterKpis(records, now),
    caveat: coverageCaveat(tallyCoverage(records).unknown),
  };
}
