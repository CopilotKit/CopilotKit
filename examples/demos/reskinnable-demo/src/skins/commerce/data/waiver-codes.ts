/**
 * BEAT 6 — the unlock catalogue.
 *
 * Approving a markdown that breaks the category margin floor is gated (422
 * BELOW_MARGIN_FLOOR). The unlock is: file a margin waiver under a code →
 * finalize it → approve. What makes that a real DEMONSTRATION rather than a
 * scripted workflow is this catalogue's shape, and all three properties are
 * load-bearing:
 *
 *   1. Only JUSTIFYING codes lift the gate.
 *   2. DECOY codes are VALID — they file, they finalize, they are recorded in
 *      the waiver history — and they do NOT justify. So "the agent filed a
 *      waiver" is not the same as "the agent cleared the gate", and an agent
 *      that guessed cannot fake its way through.
 *   3. Unknown codes are rejected WITHOUT enumerating the catalogue. If the
 *      error listed the valid codes, an agent could brute-force the recipe in
 *      one round-trip and the demonstration would prove nothing.
 *
 * The agent is never told which codes justify. It learns that by watching a
 * merchandiser file one — mirroring `src/skins/people/data/band-exception-codes.ts`
 * and `src/skins/banking/data/policy-exception-codes.ts`.
 */

export interface MarginWaiverCode {
  code: string;
  label: string;
  /** Shown in the filing UI. Never says whether the code justifies. */
  blurb: string;
}

/**
 * Everything the filing UI offers. Deliberately mixed — the justifying and the
 * decoy codes read equally plausible to someone (or something) guessing.
 */
export const MARGIN_WAIVER_CODES: readonly MarginWaiverCode[] = [
  {
    code: "VENDOR-FUND",
    label: "Vendor-funded markdown",
    blurb: "The supplier is carrying the discount under a signed co-op.",
  },
  {
    code: "EOL-CLEAR",
    label: "End-of-life clearance",
    blurb: "The SKU is exiting the range in the approved seasonal plan.",
  },
  {
    code: "COMP-MATCH",
    label: "Documented price match",
    blurb: "A competitor's published price is on file with Buying.",
  },
  {
    code: "MERCH-DISC",
    label: "Merchandiser discretion",
    blurb: "The category lead is asking for it on judgement alone.",
  },
  {
    code: "VOL-LIFT",
    label: "Expected volume lift",
    blurb: "We think the units will make up the margin.",
  },
  {
    code: "LOYALTY",
    label: "Loyalty goodwill",
    blurb: "A gesture to repeat customers in the segment.",
  },
];

/**
 * The subset that actually lifts the gate. The common thread is MONEY OR PAPER
 * THAT EXISTS OUTSIDE THE CONVERSATION — a signed co-op, an approved range exit,
 * a filed competitor price. The decoys are all forecasts and judgement calls
 * with nothing on file, which is exactly why trading policy does not accept
 * them.
 */
export const JUSTIFYING_WAIVER_CODES: readonly string[] = [
  "VENDOR-FUND",
  "EOL-CLEAR",
  "COMP-MATCH",
];

export function isValidWaiverCode(code: string): boolean {
  return MARGIN_WAIVER_CODES.some((entry) => entry.code === code);
}

export function isJustifying(code: string): boolean {
  return JUSTIFYING_WAIVER_CODES.includes(code);
}

export function waiverCodeLabel(code: string): string {
  return (
    MARGIN_WAIVER_CODES.find((entry) => entry.code === code)?.label ?? code
  );
}

/**
 * Bounds on the written justification a waiver is filed with.
 *
 * The gate is only as real as the paperwork behind it. A waiver filed under a
 * JUSTIFYING code with an empty justification used to lift beat 6's floor while
 * recording nothing whatsoever about why — the code alone did the work, and the
 * "file the paperwork" half of the demonstration became a formality that the
 * agent could satisfy by sending `""`. The floor below is what makes the filed
 * record mean something.
 *
 * The ceiling is the other half: this text is written into the durable store and
 * rendered in the waiver history, so an unbounded field is a storage hazard fed
 * straight from a model-authored tool argument.
 *
 * 8 characters is about two short words — enough for the terse-but-real entries
 * the field actually attracts ("co-op filed"), and low enough that what fails is
 * only ever a non-answer: `""`, `"   "`, `"x"`, `"n/a"`, `"ok"`, `"none"`.
 */
export const JUSTIFICATION_MIN_LENGTH = 8;
export const JUSTIFICATION_MAX_LENGTH = 500;

/**
 * Normalize a filed justification, or `null` when it is not a usable one.
 *
 * Takes `unknown` on purpose. The value arrives from a JSON body, and the
 * routes' house pattern (`String(body?.x ?? "")`) would launder a non-string
 * into a string that PASSES a length floor — `String({})` is the 15-character
 * `"[object Object]"`. Rejecting the wrong type here, at the one place the rule
 * is defined, keeps that unrepresentable rather than guarded per call site.
 *
 * Lives beside the catalogue rather than in the route so the rule holds however
 * a waiver is filed — the agent's `openMarginWaiver` tool, the merchandiser's
 * own filing panel, and any future caller all reach it through the store. Same
 * reasoning as the refund ceiling living in `store.issueRefund` rather than in
 * `POST returns/[id]/refund`.
 */
export function normalizeJustification(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < JUSTIFICATION_MIN_LENGTH) return null;
  if (trimmed.length > JUSTIFICATION_MAX_LENGTH) return null;
  return trimmed;
}
