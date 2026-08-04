import { isJustifying } from "./escalation-codes";
import type { Escalation, Planner, Shipment } from "./types";

export type AuthorityCheck =
  | { allowed: true }
  | { allowed: false; code: "OVER_AUTHORITY"; message: string };

export const formatUsd = (n: number): string =>
  `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The authority gate — this skin's analogue of banking's policy-limit gate.
 *
 * A mitigation is allowed when ANY of these holds:
 *   1. the planner has unlimited authority (a Director), OR
 *   2. the cost is at or under their authority, OR
 *   3. the shipment carries an APPROVED escalation filed under a JUSTIFYING
 *      code (a non-justifying code is recorded for history but lifts nothing).
 *
 * The rejection names only the SYMPTOM (cost vs authority) and the generic
 * recovery path. It deliberately does NOT reveal which codes are justifying —
 * the agent has to learn that from the code catalogue, exactly as banking
 * makes it learn the policy-exception recipe.
 */
export function checkAuthority(input: {
  costUsd: number;
  planner: Planner;
  shipment: Shipment;
  escalations: Escalation[];
}): AuthorityCheck {
  const { costUsd, planner, shipment, escalations } = input;

  if (planner.authorityUsd === null) return { allowed: true };
  if (costUsd <= planner.authorityUsd) return { allowed: true };

  const linked = shipment.activeEscalationId
    ? escalations.find((e) => e.id === shipment.activeEscalationId)
    : undefined;
  if (linked && linked.status === "approved" && isJustifying(linked.code)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    code: "OVER_AUTHORITY",
    message:
      `This mitigation costs ${formatUsd(costUsd)}, above your ` +
      `${formatUsd(planner.authorityUsd)} approval authority. ` +
      `File an escalation or ask a Director to approve it.`,
  };
}
