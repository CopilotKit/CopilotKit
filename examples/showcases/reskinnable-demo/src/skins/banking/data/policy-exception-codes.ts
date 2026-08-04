/**
 * Policy-exception-code catalogue for the banking demo.
 *
 * The human UI displays the `label` so a compliance officer knows what
 * each code means; everything stored in the exception record and returned
 * by the agent tools carries only the `code`. The agent has no static
 * mapping from code -> meaning — it must discover via `/knowledge` which
 * codes actually justify an approval. That's the whole point of this
 * surface for the SL demo: the writer agent watches successful officer
 * flows and learns that, e.g., `EXC-BOARD-APPROVED` is the
 * approval-justifying lever for policy overrides, while the other codes
 * are filed for recordkeeping but do not constitute a standing
 * justification.
 *
 * Adding a new code? Append it here. Adding a NEW justifying code?
 * Also list it in `JUSTIFYING_EXCEPTION_CODES` below.
 */

export interface PolicyExceptionCodeMeta {
  readonly code: string;
  readonly label: string;
}

/**
 * Catalogue shown to the human in the New exception modal. First three
 * are the justifying codes. The rest are plausible exception reasons
 * that get filed for the record but do not constitute a standing policy
 * justification.
 */
export const POLICY_EXCEPTION_CODES: ReadonlyArray<PolicyExceptionCodeMeta> = [
  // Justifying — these codes support approval of the policy exception.
  { code: "EXC-BOARD-APPROVED", label: "Board-approved spend" },
  { code: "EXC-CONTRACTUAL-COMMITMENT", label: "Contractual commitment" },
  { code: "EXC-EMERGENCY-SPEND", label: "Emergency spend" },
  // Non-justifying. Recorded for history; do not constitute a standing justification.
  { code: "EXC-WILL-REIMBURSE", label: "Employee will reimburse" },
  { code: "EXC-ONE-TIME", label: "One-time exception" },
];

/**
 * The three codes that, when filed and finalized, justify approval of
 * a policy exception. Anything else is recorded but does not provide
 * a standing justification.
 */
export const JUSTIFYING_EXCEPTION_CODES: ReadonlySet<string> = new Set<string>([
  "EXC-BOARD-APPROVED",
  "EXC-CONTRACTUAL-COMMITMENT",
  "EXC-EMERGENCY-SPEND",
]);

/**
 * Human-friendly label for a policy exception code. Falls back to the
 * raw code for unknown values (e.g. legacy records from older seeds).
 */
export const labelForExceptionCode = (code: string): string =>
  POLICY_EXCEPTION_CODES.find((c) => c.code === code)?.label ?? code;

const VALID_EXCEPTION_CODES: ReadonlySet<string> = new Set(
  POLICY_EXCEPTION_CODES.map((c) => c.code),
);

/**
 * True iff `code` belongs to the published catalogue. The store rejects
 * `openPolicyException` calls that pass an unknown code, forcing the
 * agent to learn the catalogue via `/knowledge` rather than inventing
 * plausible-looking strings.
 */
export const isValidExceptionCode = (code: string): boolean =>
  VALID_EXCEPTION_CODES.has(code);

/**
 * True iff `code` is one of the three justifying exception codes.
 * Non-justifying codes are filed for history but do not support approval.
 */
export const isJustifying = (code: string): boolean =>
  JUSTIFYING_EXCEPTION_CODES.has(code);
