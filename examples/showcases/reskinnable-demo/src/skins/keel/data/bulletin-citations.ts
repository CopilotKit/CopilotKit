/**
 * BEAT 3d — the ONE policy reference a regulatory bulletin cites that the
 * register does NOT carry, per knowledge space.
 *
 * The uncarried row is the beat's proof of reading. Every other ref on the
 * bulletin is a document the desk already holds, so an agent that never opened
 * the attachment can still file a plausible-looking brief by listing what
 * `GET /ledger` already showed it. The row below cannot be reached that way: it
 * exists only inside the document. When the filed brief names it, the room knows
 * the file was read rather than politely acknowledged — and `POST /briefs`
 * reports it back in `unmatched`, which is the honest answer rather than an
 * error.
 *
 * WHY IT IS KEYED BY SPACE. Logistics learned this shape after commerce shipped
 * the other one: a single hard-coded extra row pushed onto every generated
 * document, so `?vendor=Ardent%20Leather` returned a leather supplier quoting a
 * knit crewneck. The model lifts facts OUT of this document and narrates them as
 * fact, so a privacy-space bulletin citing a clinical policy number is the app
 * manufacturing a regulatory claim and then asserting it on stage. Each entry
 * below is therefore appropriate to the space that requests it, in the ref
 * series that space already uses.
 *
 * AND IT IS RE-CHECKED AGAINST THE LIVE REGISTER before it is emitted.
 * `freshCitationFor` drops the row when the register has come to carry that ref,
 * because then it is not fresh: the agent could have read it off the ledger and
 * the row proves nothing. A reseed that adds POL-118 therefore costs the privacy
 * bulletin its uncarried row (the document is still coherent, just a weaker
 * hook) rather than shipping a citation that quietly stopped being evidence.
 *
 * `requiredAction` is the DOCUMENT's own sentence and is deliberately stated
 * here rather than derived: it is precisely the field the brief expects the
 * model to have read, and nothing in the register can supply it.
 *
 * Server-safe: plain TS, no React, no "use client" — it is imported by a route.
 */

import type { KnowledgeSpace } from "@/skins/keel/knowledge/types";

export interface BulletinCitation {
  /** The policy number exactly as the bulletin prints it, e.g. "POL-114". */
  ref: string;
  /** The bulletin's own shorthand for the document. */
  title: string;
  /** What the bulletin says the holder of that document must now do. */
  requiredAction: string;
}

/**
 * A `Map` rather than a plain object because the key derives from a
 * caller-supplied `?space=` string: a plain-object lookup walks the prototype
 * chain, so `?space=constructor` would resolve TRUTHY and put a garbage row on
 * the bulletin.
 */
export const FRESH_CITATIONS: Map<KnowledgeSpace, BulletinCitation> = new Map([
  [
    "privacy",
    {
      ref: "POL-118",
      title: "Workforce Remote Access & Personal Device Use",
      requiredAction:
        "Adopt a written standard for personal-device access to PHI, or " +
        "record why the organization permits none.",
    } satisfies BulletinCitation,
  ],
  [
    "clinical",
    {
      ref: "POL-224",
      title: "Diagnostic Result Notification & Closed-Loop Follow-Up",
      requiredAction:
        "Document a closed-loop process for critical results, including who " +
        "confirms receipt and within what interval.",
    } satisfies BulletinCitation,
  ],
  [
    "vendor",
    {
      ref: "STD-052",
      title: "Subcontractor Flow-Down Security Controls",
      requiredAction:
        "Require vendors to flow the same evidence obligations down to any " +
        "subcontractor that touches regulated data.",
    } satisfies BulletinCitation,
  ],
]);

/**
 * The uncarried citation this space may be given, or `undefined` when it can no
 * longer be asserted as uncarried.
 *
 * `refsOnFile` is every ref the LIVE register holds — the claim "the library
 * does not carry this" is about the whole register, not about the requested
 * space's slice of it, because `POST /briefs` settles citations against the
 * whole register too. Matching is on the same canonical form the store uses, so
 * a register spelling of "POL 118" still counts as carried.
 */
export const freshCitationFor = (
  space: KnowledgeSpace,
  refsOnFile: readonly string[],
): BulletinCitation | undefined => {
  const fresh = FRESH_CITATIONS.get(space);
  if (!fresh) return undefined;
  const key = canonicalRef(fresh.ref);
  return refsOnFile.some((ref) => canonicalRef(ref) === key)
    ? undefined
    : fresh;
};

/**
 * The same reduction `store.canonicalRef` applies, restated because that one is
 * private to the store. Kept trivially identical on purpose — a looser rule here
 * would let a register that carries "POL 118" still be told it does not.
 *
 * EXPORTED so beat 3d's canvas can ask the same question of the same refs. The
 * Impact Brief canvas has to decide, per cited row, whether the library carries
 * that ref — the uncarried row is the beat's entire proof, and it is drawn
 * differently. A third private copy of this rule is exactly how one of the two
 * surfaces comes to disagree with the other about POL-118, so the canvas imports
 * this one. Two copies in the skin (this and the store's) is the floor, not an
 * accident: the store's runs where there is no import path back to here.
 */
export const canonicalRef = (ref: string) =>
  ref
    .trim()
    .replace(/[\s_-]+/g, "")
    .toUpperCase();

/**
 * What a bulletin for this space is ABOUT, and the requirements it imposes.
 *
 * Every sentence here is authored by the ISSUING BODY, which is why none of it
 * is derived from the register: a required action the app computed from its own
 * rows would be a requirement the agent could have written without opening the
 * attachment, and the whole point of beat 3d is that it could not. The register
 * supplies WHICH documents the bulletin lists; this table supplies what the
 * bulletin says about them.
 *
 * `requirements` is a rotation rather than one clause per document because the
 * carried documents are whatever the live register holds for the space — a fixed
 * per-document map would go stale the moment the corpus grows, and a single
 * repeated clause would print the same sentence nine times. Paired by index in
 * `bulletin/route.ts`, so the pairing is deterministic and testable.
 */
export interface BulletinTheme {
  /** The issuing body, as the document names itself. */
  source: string;
  /** How the bulletin describes its own scope. */
  scope: string;
  /** The summary paragraph, one sentence per entry. */
  summary: string[];
  /** Requirement clauses, rotated across the documents the bulletin lists. */
  requirements: string[];
}

export const BULLETIN_THEMES: Map<KnowledgeSpace, BulletinTheme> = new Map([
  [
    "privacy",
    {
      source: "Northeast Health Information Authority",
      scope: "Privacy and information security policy",
      summary: [
        "This bulletin sets refreshed expectations for how covered entities",
        "govern access to protected health information and evidence that",
        "governance to a surveyor. Each listed document must be assessed and",
        "the assessment recorded, whether or not it needs to change.",
      ],
      requirements: [
        "State the review interval in the document itself, not in a separate schedule.",
        "Name the role accountable for the control, not the department alone.",
        "Record the evidence a surveyor would be shown for each requirement.",
      ],
    } satisfies BulletinTheme,
  ],
  [
    "clinical",
    {
      source: "Regional Accreditation Council",
      scope: "Clinical operations and practitioner governance",
      summary: [
        "This bulletin follows the Council's most recent survey cycle and",
        "raises the documentation expected of clinical governance policies.",
        "Each listed document must be assessed and the assessment recorded,",
        "whether or not it needs to change.",
      ],
      requirements: [
        "State the notification interval in hours, not in working days.",
        "Name the committee that reviews exceptions and how often it sits.",
        "Record the evidence retained for each escalation the policy describes.",
      ],
    } satisfies BulletinTheme,
  ],
  [
    "vendor",
    {
      source: "Interstate Vendor Assurance Board",
      scope: "Vendor, procurement and third-party risk policy",
      summary: [
        "This bulletin tightens the evidence expected of third parties that",
        "handle regulated data on a covered entity's behalf. Each listed",
        "document must be assessed and the assessment recorded, whether or",
        "not it needs to change.",
      ],
      requirements: [
        "State the evidence refresh interval and what a lapse obliges the desk to do.",
        "Name the assurance tier each obligation applies to.",
        "Record how an exception is authorized and for how long it runs.",
      ],
    } satisfies BulletinTheme,
  ],
]);
