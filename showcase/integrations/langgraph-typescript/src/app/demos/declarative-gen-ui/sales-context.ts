import { useAgentContext } from "@copilotkit/react-core/v2";

// Grounding data + composition rules for the sales-analyst demo persona.
// Registered as agent context so it reaches both the primary agent (App
// Context) and the secondary A2UI planner LLM, which serialises frontend
// context entries into its system instruction.
//
// DUPLICATION NOTICE: This file is intentionally byte-duplicated across
// the langgraph-python and google-adk integrations, per the showcase's
// per-integration parity convention (no cross-integration imports). The
// two copies MUST be kept byte-for-byte identical — verify with `diff`
// after any edit, and update BOTH files in the same commit.
//
// TODO(OSS-136): Extract this dataset + composition rules into a shared
// showcase module so both integrations import a single source of truth
// instead of relying on manual byte-sync.
const SALES_DATASET = `Vantage Threads (fictional B2B apparel company) — Q2 sales data. Ground every visual in these numbers; invent only plausible details consistent with them.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: total $615k ARR across 3 accounts — Northwind Retail ($340k renewal, no contact 6 weeks; severity high), Cascadia Outfitters ($180k, champion left; severity medium), Atlas Goods ($95k, stalled legal review; severity medium).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.
- Meridian revenue by product line: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k.`;

const COMPOSITION_RULES = `Pick A2UI components by the shape of the question — never ask which chart the user wants:
1. Overall snapshot / "sales dashboard" → a Column (gap 16) whose first child is a Row (gap 16) of 4 Metric tiles (each with trend + trendValue), followed by a Row with a PieChart (revenue by region) next to a BarChart (monthly revenue, all six months Jan-Jun). Do NOT wrap the dashboard in a surrounding Card — the charts carry their own card chrome. Do NOT use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance → a Column (gap 16) with a Card containing a DataTable (columns: rep, attainment, pipeline) next to or above a BarChart of quota attainment % per rep — no StatusBadge or InfoRow.
3. Risk / health checks → a Column (gap 16): first a Row (gap 16) of 3 Metric tiles (ARR at risk $615k trend down, accounts at risk 3, biggest exposure Northwind $340k), then a Row (gap 16) with one compact Card per at-risk account (title = account name, subtitle = ARR at stake) containing a StatusBadge (error for high severity, warning otherwise) above a one-line Text with the reason and the recommended next action — no DataTable or InfoRow.
4. Single account/entity details → a Row (gap 16) with a Card of InfoRow facts (owner, region, ARR, renewal date, last contact) next to a PieChart of that account's revenue by product line — no DataTable or StatusBadge.
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
