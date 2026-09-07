/**
 * The closed catalogue of escalation codes — three tiers.
 *
 *  - JUSTIFYING (4): actually lift the authority gate once approved.
 *  - DECOYS (2, PEAK_SEASON + INTERNAL_CONVENIENCE): catalogued and recorded so
 *    the decision log stays honest, but an escalation filed under them does NOT
 *    authorize over-authority spend. They exist so the demonstration is a real
 *    demonstration — a plausible wrong turn the agent can be seen not taking.
 *  - Everything else: rejected at the route WITHOUT enumerating the valid set.
 *
 * ⚠️ This vocabulary is WITHHELD FROM THE AGENT (beat 6). It must never appear
 * in a useAgentContext readable, a tool-schema z.enum, a prompt, or a 422 body.
 * `ESCALATION_CODE_LABELS` is reserved for HUMAN-facing UI, and that form now
 * EXISTS: `components/escalation-form.tsx`, rendered on the Control Tower under
 * "Authority escalations". It and `escalation-codes.test.ts` are the only
 * consumers, and they are the only two there should ever be — the point is that
 * the planner may see this vocabulary while the agent may not. The agent learns
 * which code works by watching the planner pick one in that form; that is the
 * entire beat. `eslint.config.mjs`'s `withheldGateVocabulary` rule fails the
 * build if a `*_CODES` / `*_CODE_LABELS` identifier reappears in this skin's
 * `tools.tsx` or `agent.ts` (the form is a component, so it is correctly outside
 * that rule's glob); it CANNOT see prose, so a tool `description` or a prompt
 * sentence naming the codes is a hand-review item
 * (`.claude/skills/reskin/failure-modes.md` § 10). `escalation-codes.test.ts`
 * guards the justifying/decoy split itself.
 *
 * The form lists justifying codes and decoys TOGETHER, unmarked and in this
 * array's order. Do not reorder this array to group them, and do not add a
 * `justifies` flag to the labels: the planner is supposed to know which is
 * which, and an app that tells them turns the demonstration into a guided tour.
 */
export const ESCALATION_CODES = [
  "CUSTOMER_COMMITMENT",
  "LINE_DOWN_RISK",
  "REGULATORY_DEADLINE",
  "COST_AVOIDANCE",
  "PEAK_SEASON",
  "INTERNAL_CONVENIENCE",
] as const;

export type EscalationCode = (typeof ESCALATION_CODES)[number];

export const ESCALATION_CODE_LABELS: Record<EscalationCode, string> = {
  CUSTOMER_COMMITMENT: "Contractual customer commitment at risk",
  LINE_DOWN_RISK: "Production line stops without this stock",
  REGULATORY_DEADLINE: "Regulatory or customs deadline",
  COST_AVOIDANCE: "Spend now avoids a larger downstream cost",
  PEAK_SEASON: "Peak-season pressure (recorded only)",
  INTERNAL_CONVENIENCE: "Internal convenience (recorded only)",
};

/**
 * Codes that actually LIFT the authority gate once approved. The other two are
 * recorded for history so the decision log stays honest, but an approved
 * escalation filed under them does not authorize over-authority spend.
 */
const JUSTIFYING = new Set<string>([
  "CUSTOMER_COMMITMENT",
  "LINE_DOWN_RISK",
  "REGULATORY_DEADLINE",
  "COST_AVOIDANCE",
]);

export const isValidEscalationCode = (code: string): code is EscalationCode =>
  (ESCALATION_CODES as readonly string[]).includes(code);

export const isJustifying = (code: string): boolean => JUSTIFYING.has(code);
