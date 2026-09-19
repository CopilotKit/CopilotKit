"use client";

import { CopilotChat, useAgentContext } from "@copilotkit/react-core/v2";
import { useDeclarativeGenUISuggestions } from "./suggestions";

// Selected canonical demo facts and composition from built-in-agent's
// declarative-gen-ui/sales-context.ts; kept local to this standalone integration.
const SALES_DATASET = `Vantage Threads (fictional B2B apparel company) — Q2 sales data. These are canonical demo values, not live business facts. Ground every visual in these numbers; do not invent additional sales figures.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: total $615k ARR across 3 accounts — Northwind Retail ($340k renewal, no contact 6 weeks; severity high), Cascadia Outfitters ($180k, champion left; severity medium), Atlas Goods ($95k, stalled legal review; severity medium).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.
- Meridian revenue by product line: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k.
- Per-rep pipeline amounts are unavailable; omit that column or display "Unavailable", never invent amounts.`;

const COMPOSITION_RULES = `Pick A2UI components by the shape of the question; use the registered component schema and never ask which chart the user wants:
1. Overall snapshot / "sales dashboard": a Column whose first child is a Row of exactly 4 Metric tiles (quarterly revenue $4.2M trend up, new customers 186 trend up, win rate 31% trend down, average deal size $22.6k trend up), followed by a Row with one PieChart of revenue by region and one BarChart of monthly revenue using all six months Jan-Jun. Keep the KPI strip bare; do not wrap the dashboard in a surrounding Card. Do not use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance: a Column with a Card whose child is a Column containing one DataTable followed by one BarChart of quota attainment percentages for all five reps. Use table columns rep and attainment; if pipeline is included, display "Unavailable" for every rep. Table attainment and chart values must agree. Do not use StatusBadge or InfoRow.
3. Risk / health checks: a Column starting with a Row of exactly 3 Metric tiles (ARR at risk $615k trend down, accounts at risk 3, biggest exposure Northwind $340k), followed by one compact Card per at-risk account. Each Card contains a Column with one StatusBadge (error for Northwind Retail's high severity, warning for Cascadia Outfitters and Atlas Goods) and Text describing the stated risk reason. Use exactly 3 StatusBadge components. Do not use DataTable or InfoRow.
4. Single account details: a Column with a Card containing a Column of InfoRow facts for Meridian Apparel Group (owner, region, ARR, renewal date, last contact, health, open opportunities) followed by one PieChart of its revenue by product line. Do not use DataTable or StatusBadge.
Use each Card's child property to reference its single child component. Use only properties in the registered schema; do not add gap or trendValue. Chart values are numeric amounts, or numeric percentages for quota attainment.`;

export function Chat() {
  useAgentContext({
    description: "Sales dataset for Vantage Threads (the demo company)",
    value: SALES_DATASET,
  });
  useAgentContext({
    description: "Dashboard composition rules for A2UI surfaces",
    value: COMPOSITION_RULES,
  });
  useDeclarativeGenUISuggestions();
  return (
    <CopilotChat agentId="declarative-gen-ui" className="h-full rounded-2xl" />
  );
}
