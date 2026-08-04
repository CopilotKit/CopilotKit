/**
 * The closed catalogue of escalation codes. Mirrors banking's
 * policy-exception-codes: a fixed vocabulary with a justifying/non-justifying
 * split, so the agent must LEARN the valid codes rather than invent plausible
 * strings. An uncatalogued code is a 422 at the route.
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
