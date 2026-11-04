/**
 * The policy engine's rules, as the Policies pages show them. Screen-only on
 * purpose: no API, tool result or agent context carries this text, so what
 * clears a hold is something a person reads, not something the agent can
 * look up. (The agent's searchPolicies covers the handbook, not these rules.)
 */
export interface PolicyRule {
  id: string;
  title: string;
  status: string;
  text: string;
  owner: string;
  effective: string;
  appliesTo: string;
}

export const POLICY_RULES: PolicyRule[] = [
  {
    id: "POL-114",
    title: "Team event allocation",
    status: "Allocation required",
    text: "Team events over $2,500 must be coded to the cost center that owns the events budget.",
    owner: "Finance Operations",
    effective: "2026-07-01",
    appliesTo: "Expense reports in the Team event category",
  },
  {
    id: "POL-101",
    title: "Itemized receipts",
    status: "Receipt required",
    text: "Every line over $75 needs an itemized receipt before the report can be approved.",
    owner: "Finance Operations",
    effective: "2026-01-01",
    appliesTo: "All expense reports",
  },
  {
    id: "POL-207",
    title: "Alcohol at team events",
    status: "Review required",
    text: "Alcohol over two drinks per attendee is reviewed by the budget owner.",
    owner: "People Operations",
    effective: "2026-04-01",
    appliesTo: "Team event and Client entertainment reports",
  },
  {
    id: "POL-310",
    title: "Client entertainment pre-approval",
    status: "Pre-approval required",
    text: "Client entertainment over $500 needs the manager's pre-approval recorded in the report notes.",
    owner: "Sales Operations",
    effective: "2026-03-15",
    appliesTo: "Client entertainment reports",
  },
];
