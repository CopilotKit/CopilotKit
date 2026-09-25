/**
 * The seeded policy register — one row per corpus document.
 *
 * WHY THIS DERIVES FROM `KEEL_CORPUS` RATHER THAN RESTATING IT. `ref`, `title`,
 * `space` and `owner` are copied off the corpus document at seed time, and the
 * overlay below carries ONLY lifecycle state. Two hand-written lists with no
 * drift guard is exactly how a register ends up citing a policy number the
 * library does not carry — and this skin's whole credibility claim is that it
 * never invents a policy ref. `register-seed.test.ts` fails if the overlay names
 * a document the corpus does not have, or if the corpus gains one the overlay
 * does not cover.
 *
 * WHY EVERY DATE IS RELATIVE TO `now`. Keel's run seed already works this way
 * (see `seed.ts`), for a reason that applies here twice over: the live app
 * compares `reviewDue` against the wall clock to decide what is overdue, so a
 * fixed calendar anchor would quietly turn every row overdue as the months pass
 * and beat 3c's `review_overdue` lever would stop discriminating. `now` is a
 * PARAMETER so a reseed tracks the clock and tests stay deterministic.
 *
 * HOW THE ROWS ARE ARRANGED, AND WHY IT IS NOT ARBITRARY. A too-thin seed makes
 * a filter indistinguishable from a broken filter on stage, so every lever value
 * has to leave several rows:
 *
 *   space=privacy   3    attention=review_overdue       3   (POL-114, POL-121, POL-203)
 *   space=clinical  3    attention=attestation_short    3   (POL-114, POL-203, STD-045)
 *   space=vendor    3    attention=unendorsed_revision  2   (POL-114, POL-208)
 *
 * The `unendorsed_revision` pair IS beat 6's two gated cases, which is the point
 * of that lever: the maneuver lands the presenter directly on the worklist the
 * teach arc is about.
 *
 * THREE PENDING REVISIONS, AND THE THIRD IS NOT AN AFTERTHOUGHT:
 *
 *   POL-114 Rev D  missing Policy Governance Committee  -> beat 6, taught on stage
 *   POL-208 Rev C  missing Policy Governance Committee  -> beat 6, replayed unaided
 *   STD-045 Rev B  fully endorsed                       -> beat 3a's countersign
 *
 * Beat 3a's card must offer an act the operator is ALREADY authorized to take
 * (`.claude/skills/reskin/failure-modes.md` § 12) — a PIN that RELEASES what the
 * gate is refusing would be a second door around beat 6, the agent would take
 * it, the teach arc would never fire, and nothing would fail. STD-045 Rev B is
 * that authorized act, and it is seeded here rather than discovered later
 * because without it beat 3a has nothing to point at.
 */

import { KEEL_CORPUS } from "@/skins/keel/knowledge/corpus";
import type { Attestation, DocumentRecord, Revision } from "./types";

const DAY_MS = 86_400_000;

/** `now` + `days`, as an ISO date (YYYY-MM-DD) at UTC. */
const day = (now: number, days: number): string =>
  new Date(now + days * DAY_MS).toISOString().slice(0, 10);

/** `now` + `days`, as a full ISO timestamp. */
const stamp = (now: number, days: number): string =>
  new Date(now + days * DAY_MS).toISOString();

/**
 * The endorsement body every policy revision at Harbor Point needs, and the one
 * that has not signed on either gated case. Named once because the refusal
 * message, the seed and the human filing form must all say it the same way.
 */
export const GOVERNANCE_BODY = "Policy Governance Committee";

interface Overlay {
  status: DocumentRecord["status"];
  effectiveRevision?: string;
  /** Days BEFORE `now` the document was last reviewed. */
  reviewedDaysAgo: number;
  /** Days from `now` the review falls due. Negative = already overdue. */
  reviewDueInDays: number;
  attestation: Attestation;
  pending?: (now: number) => Revision;
}

/**
 * A revision awaiting a single missing endorsement — beat 6's shape.
 * The named body endorsed; `GOVERNANCE_BODY` has not.
 */
const gatedRevision =
  (
    label: string,
    summary: string,
    authoredBy: string,
    endorsedBody: string,
    endorsedBy: string,
  ) =>
  (now: number): Revision => ({
    label,
    stage: "draft",
    summary,
    authoredBy,
    requiredEndorsements: [
      {
        body: endorsedBody,
        endorsedAt: stamp(now, -9),
        endorsedBy,
      },
      // No `endorsedAt` — this absence IS the gate.
      { body: GOVERNANCE_BODY },
    ],
  });

/**
 * Lifecycle state per corpus document, keyed by `docId`. Everything descriptive
 * (ref, title, space, owner) comes from the corpus and is deliberately absent
 * here.
 */
const OVERLAY: Record<string, Overlay> = {
  // ── privacy ────────────────────────────────────────────────────────────
  "phi-access-policy": {
    status: "in_review",
    effectiveRevision: "Rev C",
    reviewedDaysAgo: 400,
    reviewDueInDays: -35,
    // 88% — deliberately just under the 90% target, so the lever discriminates
    // rather than separating obviously-broken rows from obviously-fine ones.
    attestation: { assigned: 1240, completed: 1102 },
    pending: gatedRevision(
      "Rev D",
      "Adds a standing minimum-necessary review for contractor accounts and a 30-day access recertification.",
      "Privacy Office",
      "Privacy Officer",
      "Sam Okafor",
    ),
  },
  "breach-response": {
    status: "published",
    effectiveRevision: "Rev B",
    reviewedDaysAgo: 465,
    reviewDueInDays: -100,
    attestation: { assigned: 1240, completed: 1240 },
  },
  "data-classification": {
    status: "published",
    effectiveRevision: "Rev E",
    reviewedDaysAgo: 190,
    reviewDueInDays: 175,
    attestation: { assigned: 860, completed: 842 },
  },

  // ── clinical ───────────────────────────────────────────────────────────
  "credentialing-standard": {
    status: "published",
    effectiveRevision: "Rev F",
    reviewedDaysAgo: 320,
    reviewDueInDays: -12,
    attestation: { assigned: 410, completed: 362 },
  },
  "adverse-event-reporting": {
    status: "in_review",
    effectiveRevision: "Rev B",
    reviewedDaysAgo: 150,
    reviewDueInDays: 215,
    attestation: { assigned: 1240, completed: 1155 },
    pending: gatedRevision(
      "Rev C",
      "Shortens the leadership notification window for severity 1 and 2 events and adds a near-miss trend review.",
      "Quality & Safety",
      "Chief Medical Officer",
      "Dr. Marcus Ellis",
    ),
  },
  "infection-control": {
    status: "published",
    effectiveRevision: "Rev D",
    reviewedDaysAgo: 240,
    reviewDueInDays: 125,
    attestation: { assigned: 1240, completed: 1240 },
  },

  // ── vendor ─────────────────────────────────────────────────────────────
  "baa-requirements": {
    status: "published",
    effectiveRevision: "Rev C",
    reviewedDaysAgo: 120,
    reviewDueInDays: 245,
    attestation: { assigned: 96, completed: 96 },
  },
  "third-party-risk": {
    status: "in_review",
    effectiveRevision: "Rev A",
    reviewedDaysAgo: 210,
    reviewDueInDays: 155,
    attestation: { assigned: 96, completed: 54 },
    // BEAT 3a — fully endorsed, so the release is an act the operator is
    // already authorized to take and the e-signature PIN confirms only WHO is
    // acting. Both bodies carry an `endorsedAt`.
    pending: (now: number): Revision => ({
      label: "Rev B",
      stage: "endorsed",
      summary:
        "Raises Tier 1 evidence to a current SOC 2 Type II or HITRUST report and adds a bridge-letter rule.",
      authoredBy: "Information Security",
      requiredEndorsements: [
        {
          body: "Information Security Lead",
          endorsedAt: stamp(now, -6),
          endorsedBy: "Lin Whitaker",
        },
        {
          body: GOVERNANCE_BODY,
          endorsedAt: stamp(now, -2),
          endorsedBy: "Dr. Marcus Ellis",
        },
      ],
    }),
  },
  "procurement-thresholds": {
    status: "draft",
    // No `effectiveRevision`: never released to the workforce, which is exactly
    // why nobody is assigned to attest to it — the reachable "unknown coverage"
    // case `attention.ts` exists for.
    reviewedDaysAgo: 300,
    reviewDueInDays: 65,
    attestation: { assigned: 0, completed: 0 },
  },
};

/**
 * Build the register. Every row is derived from a corpus document; a corpus
 * document with no overlay is SKIPPED rather than guessed at, and
 * `register-seed.test.ts` fails on that case so the skip can never be the
 * silent answer.
 */
export function seedRegister(now: number = Date.now()): DocumentRecord[] {
  const records: DocumentRecord[] = [];
  for (const doc of KEEL_CORPUS) {
    const overlay = OVERLAY[doc.id];
    if (!overlay) continue;
    records.push({
      docId: doc.id,
      ref: doc.ref,
      title: doc.title,
      space: doc.space,
      owner: doc.owner,
      status: overlay.status,
      effectiveRevision: overlay.effectiveRevision,
      lastReviewed: day(now, -overlay.reviewedDaysAgo),
      reviewDue: day(now, overlay.reviewDueInDays),
      attestation: { ...overlay.attestation },
      pendingRevision: overlay.pending?.(now),
    });
  }
  return records;
}

/** The docIds the overlay covers. Exported for the drift test only. */
export const SEEDED_DOC_IDS = Object.keys(OVERLAY);
