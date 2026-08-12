/**
 * The closed catalogue of publication-variance codes — three tiers.
 *
 *  - JUSTIFYING (4): actually lift the release gate once the variance is
 *    ratified.
 *  - DECOYS (2, COMMITTEE_CALENDAR + EDITORIAL_CLEANUP): catalogued and recorded
 *    so the register stays honest, but a variance filed under them does NOT
 *    authorize releasing an unendorsed revision. They exist so the demonstration
 *    is a real demonstration — a plausible wrong turn the agent can be seen not
 *    taking. `COMMITTEE_CALENDAR` is the load-bearing one: "the committee does
 *    not meet until next quarter" is the exact reason a real person reaches for
 *    an interim release, so it is the code a bluffing agent picks. Watching a
 *    ratified COMMITTEE_CALENDAR variance leave the release STILL blocked is the
 *    demonstration working, not failing.
 *  - Everything else: rejected at the route WITHOUT enumerating the valid set.
 *
 * ⚠️ THIS VOCABULARY IS WITHHELD FROM THE AGENT (beat 6). It must never appear
 * in a `useAgentContext` readable, a tool-schema `z.enum`, a tool `description`,
 * the agent prompt, or a 4xx body. An agent holding these codes already knows
 * the procedure, clears the gate unaided, and there is nothing left to teach —
 * the demo still runs, beautifully, and proves nothing.
 *
 * `VARIANCE_CODE_LABELS` is reserved for HUMAN-facing UI: the variance filing
 * form a later slot renders on the Register page. That form is the SIXTH channel
 * and the one that must be OPEN — the agent learns which code works by watching
 * the operator pick one in it, and a skin that withholds perfectly and ships no
 * form has an unlearnable gate. Two properties of that form are load-bearing
 * when it is built: it lists justifying codes and decoys TOGETHER, unmarked and
 * in this array's order (a form that flagged the working ones turns the
 * demonstration into a guided tour), and it logs the code as DATA exactly as the
 * operator entered it, decoy included.
 *
 * Do not reorder this array to group the tiers, and do not add a `justifies`
 * flag to the labels.
 *
 * `eslint.config.mjs`'s `withheldGateVocabulary` rule fails the build if a
 * `*_CODES` / `*_CODE_LABELS` identifier appears in a covered skin's `tools.tsx`
 * or `agent.ts` — keel is NOT in that rule's `files` glob yet, because keel has
 * no gate-facing tool yet. **The slot that writes `tools.tsx` must append
 * `src/skins/keel/tools.tsx` AND `src/skins/keel/agent.ts` to it, restating the
 * LOCK_SKIN selectors in the same block** (flat-config `rules` are replaced, not
 * merged). And note the rule matches IDENTIFIERS only: a tool `description`, a
 * prompt sentence and a 4xx body are prose, and are a hand-review item
 * (`.claude/skills/reskin/failure-modes.md` § 10).
 */
export const VARIANCE_CODES = [
  "PATIENT_SAFETY_ALERT",
  "ACCREDITATION_FINDING",
  "REGULATORY_MANDATE",
  "INCIDENT_CONTAINMENT",
  "COMMITTEE_CALENDAR",
  "EDITORIAL_CLEANUP",
] as const;

export type VarianceCode = (typeof VARIANCE_CODES)[number];

export const VARIANCE_CODE_LABELS: Record<VarianceCode, string> = {
  PATIENT_SAFETY_ALERT:
    "Active safety alert requires the revised text in effect now",
  ACCREDITATION_FINDING:
    "Survey finding requires immediate correction of this policy",
  REGULATORY_MANDATE:
    "Statutory or payer requirement with a fixed effective date",
  INCIDENT_CONTAINMENT:
    "Open privacy or security incident depends on this text",
  COMMITTEE_CALENDAR:
    "Governing committee does not meet until next quarter (recorded only)",
  EDITORIAL_CLEANUP:
    "Typographical and formatting corrections only (recorded only)",
};

/**
 * Codes that actually LIFT the release gate once the variance is ratified. The
 * other two are recorded for history so the register stays honest, but a
 * ratified variance filed under them does not authorize releasing an unendorsed
 * revision.
 */
const JUSTIFYING = new Set<string>([
  "PATIENT_SAFETY_ALERT",
  "ACCREDITATION_FINDING",
  "REGULATORY_MANDATE",
  "INCIDENT_CONTAINMENT",
]);

export const isValidVarianceCode = (code: string): code is VarianceCode =>
  (VARIANCE_CODES as readonly string[]).includes(code);

export const isJustifying = (code: string): boolean => JUSTIFYING.has(code);
