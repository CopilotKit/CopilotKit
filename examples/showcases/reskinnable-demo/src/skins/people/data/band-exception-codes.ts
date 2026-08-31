/**
 * BEAT 6 — the unlock catalogue.
 *
 * Approving an out-of-band comp request is gated (422 OUT_OF_BAND). The unlock
 * is: file a band exception under a code → finalize it → approve. What makes
 * that a real DEMONSTRATION rather than a scripted workflow is this catalogue's
 * shape, and all three properties are load-bearing:
 *
 *   1. Only JUSTIFYING codes lift the gate.
 *   2. DECOY codes are VALID — they file, they finalize, they are recorded in
 *      the exception history — and they do NOT justify. So "the agent filed an
 *      exception" is not the same as "the agent cleared the gate", and an agent
 *      that guessed cannot fake its way through.
 *   3. Unknown codes are rejected WITHOUT enumerating the catalogue. If the
 *      error listed the valid codes, an agent could brute-force the recipe in
 *      one round-trip and the demonstration would prove nothing.
 *
 * The agent is never told which codes justify. It learns that by watching a
 * human file one — mirroring `src/skins/banking/data/policy-exception-codes.ts`.
 */

export interface BandExceptionCode {
  code: string;
  label: string;
  /** Shown in the filing UI. Never says whether the code justifies. */
  blurb: string;
}

/**
 * Everything the filing UI offers. Deliberately mixed — the justifying and the
 * decoy codes read equally plausible to someone (or something) guessing.
 */
export const BAND_EXCEPTION_CODES: readonly BandExceptionCode[] = [
  {
    code: "MKT-ADJ",
    label: "Market adjustment",
    blurb: "Benchmarked against a current external salary survey.",
  },
  {
    code: "RETENTION",
    label: "Documented retention case",
    blurb: "A competing written offer is on file with People Ops.",
  },
  {
    code: "PROMO-BAND",
    label: "Promotion ahead of band refresh",
    blurb: "Scope already at the next level; band review is queued.",
  },
  {
    code: "MGR-DISC",
    label: "Manager discretion",
    blurb: "The hiring manager is asking for it on judgement alone.",
  },
  {
    code: "TENURE",
    label: "Long tenure",
    blurb: "Recognition of years of service.",
  },
  {
    code: "COST-LIV",
    label: "Cost-of-living pressure",
    blurb: "Local cost pressure raised by the employee.",
  },
];

/**
 * The subset that actually lifts the gate. The common thread is EVIDENCE that
 * exists outside the conversation — a benchmark, a written offer, a queued band
 * review. The decoys are all judgement calls with nothing on file, which is why
 * comp policy doesn't accept them.
 */
export const JUSTIFYING_EXCEPTION_CODES: readonly string[] = [
  "MKT-ADJ",
  "RETENTION",
  "PROMO-BAND",
];

export function isValidExceptionCode(code: string): boolean {
  return BAND_EXCEPTION_CODES.some((entry) => entry.code === code);
}

export function isJustifying(code: string): boolean {
  return JUSTIFYING_EXCEPTION_CODES.includes(code);
}

export function exceptionCodeLabel(code: string): string {
  return (
    BAND_EXCEPTION_CODES.find((entry) => entry.code === code)?.label ?? code
  );
}
