import { COST_CENTERS } from "./seed";
import type { CostCenter, ExpenseReport } from "./types";
import { EVENTS_THRESHOLD } from "./types";

/**
 * POL-114, the team-event rule, as the policy engine evaluates it.
 *
 * A Team event report over $2,500 passes only when every EVENT line (venue,
 * catering) is coded to a cost center whose budget type is "events", and no
 * other line (transport, supplies) is. The rule's text lives on the policy
 * page; the budget types live on the Cost centers page. Nothing the agent can
 * read states either, which is the point of the demo.
 *
 * `reason` is for the person in the app, explaining why a recode did not
 * clear the hold. It is never returned to the agent.
 */
export interface PolicyCheck {
  code: "POL-114";
  status: "open" | "resolved";
  reason?: string;
}

export function evaluateTeamEvent(
  r: Pick<ExpenseReport, "category" | "total" | "lines">,
  centers: CostCenter[] = COST_CENTERS,
): PolicyCheck {
  if (r.category !== "Team event" || r.total <= EVENTS_THRESHOLD) {
    return { code: "POL-114", status: "resolved" };
  }
  const cc = (id: string) => centers.find((c) => c.id === id);
  for (const l of r.lines.filter((x) => x.eventCost)) {
    const c = cc(l.costCenterId);
    if (c?.budgetType !== "events") {
      return {
        code: "POL-114",
        status: "open",
        reason: `${l.description} is coded to ${l.costCenterId}${c ? ` ${c.name}, a ${c.budgetType} budget` : ""}.`,
      };
    }
  }
  for (const l of r.lines.filter((x) => !x.eventCost)) {
    if (cc(l.costCenterId)?.budgetType === "events") {
      return {
        code: "POL-114",
        status: "open",
        reason: `${l.description} is not event spend, so it cannot be charged to the events budget.`,
      };
    }
  }
  return { code: "POL-114", status: "resolved" };
}
