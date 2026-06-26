import type { GovernancePillar, GovernanceVerdict } from "./types";

/** Minimal scenario shape consumed for fallback copy. */
export interface PillarScenario {
  capability?: string;
}

export interface PillarSignals {
  verdict: GovernanceVerdict;
  redactionSummary?: string;
  hasGuardrailsSignal: boolean;
}

/**
 * Derive the triggering Authorize pillar.
 * Precedence:
 *   1. Guardrails/redaction signals -> guardrails.
 *   2. Approval gate -> behavioral_rules.
 *   3. block/halt without guardrails signals -> policies.
 *   4. Fall back to scenario capability copy.
 *   5. unknown.
 */
export function derivePillar(
  signals: PillarSignals,
  scenario: PillarScenario | undefined,
): GovernancePillar {
  const hasRedaction =
    typeof signals.redactionSummary === "string" &&
    signals.redactionSummary.length > 0;
  if (hasRedaction || signals.hasGuardrailsSignal) return "guardrails";
  if (signals.verdict === "approval") return "behavioral_rules";
  if (signals.verdict === "block" || signals.verdict === "halt")
    return "policies";

  const capability = (scenario?.capability ?? "").toLowerCase();
  if (capability) {
    if (capability.includes("approval") || capability.includes("behavior"))
      return "behavioral_rules";
    if (capability.includes("guardrail") || capability.includes("redaction"))
      return "guardrails";
    if (capability.includes("policy") || capability.includes("drift"))
      return "policies";
  }
  return "unknown";
}

export function pillarLabel(pillar: GovernancePillar): string {
  switch (pillar) {
    case "guardrails":
      return "Guardrails";
    case "policies":
      return "Policies";
    case "behavioral_rules":
      return "Behavioral rules";
    default:
      return "Governance";
  }
}
