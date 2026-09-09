/**
 * BEAT 6 — the release gate. This skin's analogue of banking's policy-limit gate
 * and logistics' authority gate.
 *
 * A pending revision may go to the workforce when EITHER:
 *   1. every body on its required-endorsement list has endorsed it, OR
 *   2. it carries a RATIFIED publication variance filed under a JUSTIFYING code
 *      (a decoy code is recorded for history and lifts nothing).
 *
 * ⚠️ THE REFUSAL NAMES ONLY THE SYMPTOM. It states the document, the revision
 * and which body has not signed — facts an operator can see on the register row
 * — and says nothing whatsoever about variances, codes, catalogues, or any way
 * through. An operator who knows the procedure reads it and knows what to file;
 * an agent that does not, does not. That asymmetry IS beat 6. A refusal that
 * named the fix would leave nothing to teach, and the demo would still run
 * beautifully and prove nothing.
 *
 * ⚠️ AND IT IS THE ONLY GATE. Beat 3a's e-signature countersignature route runs
 * this SAME function on the same record, so a valid PIN on an unendorsed
 * revision is refused identically. A second factor confirms WHO is acting; it
 * never changes WHAT they may release. If the PIN could release an unendorsed
 * revision the agent would simply take that door, the teach arc would never
 * fire, and NOTHING would fail —
 * `src/app/api/keel/v1/countersignatures/route.test.ts` is the only symptom that
 * failure has.
 *
 * Server-safe: plain TypeScript, no React.
 */

import { missingEndorsements } from "./attention";
import { isJustifying } from "./variance-codes";
import type { DocumentRecord, Variance } from "./types";

export type ReleaseCheck =
  | { allowed: true; via: "endorsed" | "variance"; varianceId?: string }
  | {
      allowed: false;
      code: "UNENDORSED_REVISION";
      message: string;
      /** The bodies that have not signed. The symptom, and only the symptom. */
      missing: string[];
    };

/**
 * `and`-joined body names, so a refusal reads as a sentence rather than as a
 * serialized array. One body is the seeded case; the plural branch exists
 * because a revision can require three and a message reading
 * "has not been endorsed by A,B" is the kind of detail a room notices.
 */
const listBodies = (bodies: string[]): string => {
  if (bodies.length <= 1) return bodies[0] ?? "";
  return `${bodies.slice(0, -1).join(", ")} and ${bodies[bodies.length - 1]}`;
};

export function checkReleaseAuthority(input: {
  record: DocumentRecord;
  variances: Variance[];
}): ReleaseCheck {
  const { record, variances } = input;
  const revision = record.pendingRevision;
  // A caller with no pending revision is a caller error, not a gate refusal, and
  // the routes answer it separately (409). Returning "allowed" here would let
  // that bug release nothing quietly; refusing with the gate's own code would
  // teach the operator to file a variance against a revision that does not
  // exist. So this branch is unreachable from the routes by construction — they
  // check for the revision first — and is written to fail closed regardless.
  if (!revision) {
    return {
      allowed: false,
      code: "UNENDORSED_REVISION",
      message: `${record.ref} has no revision awaiting release.`,
      missing: [],
    };
  }

  const missing = missingEndorsements(record);
  if (missing.length === 0) return { allowed: true, via: "endorsed" };

  const linked = revision.activeVarianceId
    ? variances.find((v) => v.id === revision.activeVarianceId)
    : undefined;
  if (linked && linked.status === "ratified" && isJustifying(linked.code)) {
    return { allowed: true, via: "variance", varianceId: linked.id };
  }

  return {
    allowed: false,
    code: "UNENDORSED_REVISION",
    message:
      `${revision.label} of ${record.ref} has not been endorsed by ` +
      `${listBodies(missing)}. It cannot be released to the workforce.`,
    missing,
  };
}

/** One document whose pending revision the desk cannot release as things stand. */
export interface GatedCase {
  record: DocumentRecord;
  revision: string;
  missing: string[];
}

/**
 * BEAT 6 — every case the operator-facing variance filing form may legitimately
 * offer.
 *
 * Derived, never stored: it runs the very same `checkReleaseAuthority` the
 * ROUTE runs, so the form can never advertise a case the gate would in fact
 * allow (or hide one it would refuse). A revision already cleared by a ratified
 * justifying variance drops off the list — the demonstration that taught the
 * procedure cleared one of these, and leaving it there invites the presenter to
 * demonstrate twice on the same document.
 */
export function gatedRevisions(
  records: DocumentRecord[],
  variances: Variance[],
): GatedCase[] {
  const cases: GatedCase[] = [];
  for (const record of records) {
    if (!record.pendingRevision) continue;
    const verdict = checkReleaseAuthority({ record, variances });
    if (verdict.allowed) continue;
    cases.push({
      record,
      revision: record.pendingRevision.label,
      missing: verdict.missing,
    });
  }
  return cases;
}
