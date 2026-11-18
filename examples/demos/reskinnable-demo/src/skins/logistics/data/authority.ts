import { isJustifying } from "./escalation-codes";
import { computeMitigationOptions } from "./mitigation-options";
import type {
  Escalation,
  Lane,
  MitigationOption,
  Planner,
  Shipment,
} from "./types";

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

/** One shipment the acting planner cannot release on their own authority. */
export interface BlockedCase {
  shipment: Shipment;
  /**
   * The CHEAPEST option that is still over the cap. Cheapest rather than
   * costliest on purpose: it is the option a planner would actually reach for,
   * and it is the one the gate refuses first — picking the most expensive would
   * put a number on the filing form that nobody in the demo ever tried to
   * commit.
   */
  option: MitigationOption;
}

/**
 * BEAT 6 — every case the planner-facing escalation form may legitimately offer.
 *
 * Derived, never stored: costs come from `computeMitigationOptions`, the same
 * pure function the SERVER recomputes with on every mitigate request, so the
 * form can never advertise a figure the gate would not actually check. A
 * Director (`authorityUsd === null`) is blocked by nothing and therefore has no
 * cases at all — which is why the form renders its empty state for them rather
 * than a filing UI that could never lift anything.
 *
 * Shipments with a mitigation already applied are dropped: the demonstration
 * that taught the procedure released one of these, and leaving it on the list
 * afterwards invites the presenter to demonstrate twice on the same case.
 */
export function blockedByAuthority(
  shipments: Shipment[],
  lanes: Lane[],
  authorityUsd: number | null,
): BlockedCase[] {
  if (authorityUsd === null) return [];
  const cases: BlockedCase[] = [];
  for (const shipment of shipments) {
    if (shipment.appliedMitigation) continue;
    const option = computeMitigationOptions(shipment, lanes)
      .filter((o) => o.costUsd > authorityUsd)
      .sort((a, b) => a.costUsd - b.costUsd)[0];
    if (option) cases.push({ shipment, option });
  }
  return cases;
}
