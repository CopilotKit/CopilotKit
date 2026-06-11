import { useAgentContext } from "@copilotkit/react-core/v2";

// Grounding data + composition rules for the sales-analyst demo persona.
// Registered as agent context so it reaches both the primary agent (App
// Context) and the secondary A2UI planner LLM, which serialises frontend
// context entries into its system instruction. Keep this file identical
// across integrations (langgraph-python, google-adk) — it is the single
// source of truth for the demo's fictional dataset.
const SALES_DATASET = `Vantage Threads (fictional B2B apparel company) — Q2 sales data. Ground every visual in these numbers; invent only plausible details consistent with them.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: Northwind Retail ($340k renewal, no contact 6 weeks), Cascadia Outfitters ($180k, champion left), Atlas Goods ($95k, stalled legal review).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.`;

const COMPOSITION_RULES = `Pick A2UI components by the shape of the question — never ask which chart the user wants:
1. Overall snapshot / "sales dashboard" → one Card titled as a quarterly dashboard containing a Row (gap 16) of 4 Metric tiles (each with trend + trendValue), then a Row with a PieChart (revenue by region) next to a BarChart (monthly revenue). Do NOT use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance → a Card with a DataTable (columns: rep, attainment, pipeline) — no charts, badges, or InfoRows.
3. Risk / health checks → a Card per at-risk item with a StatusBadge (warning or error) and short Text explanation — no charts, tables, or InfoRows.
4. Single account/entity details → a Card with InfoRow facts (owner, region, ARR, renewal date, last contact) — no charts, tables, or badges.
5. Part-of-whole follow-ups → PieChart; trends or comparisons over time/categories → BarChart.
Compose generously — a dashboard should feel like a real analytics product, not a single widget.`;

export function useSalesAnalystContext() {
  useAgentContext({
    description: "Sales dataset for Vantage Threads (the demo company)",
    value: SALES_DATASET,
  });
  useAgentContext({
    description: "Dashboard composition rules for A2UI surfaces",
    value: COMPOSITION_RULES,
  });
}
