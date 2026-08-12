"""Dedicated Strands agent for the Declarative Generative UI (A2UI — Dynamic
Schema) demo.

Strands port of the canonical langgraph-python ``a2ui_dynamic`` demo
(``../../../langgraph-python/src/agents/a2ui_dynamic.py``). Unlike the
fixed-schema demo (which wires a single ``display_flight`` tool returning a
pre-authored ``a2ui_operations`` envelope), the dynamic demo lets the agent
*generate* the surface layout on the fly.

How the generation is wired (no manual tool):
  - The Next.js runtime route (``app/api/copilotkit-declarative-gen-ui/
    route.ts``) sets ``a2ui: { injectA2UITool: true, defaultCatalogId:
    "declarative-gen-ui-catalog" }``.
  - The CopilotKit runtime forwards that ``injectA2UITool`` flag to this
    agent, and the Strands adapter auto-injects a ``generate_a2ui`` tool +
    drives a secondary ``render_a2ui`` planner LLM to emit the surface ops.
  - The ``StrandsAgentConfig.a2ui`` block below supplies the
    ``default_catalog_id`` stamped into generated surfaces and the
    ``composition_guide`` that teaches the planner which components the page's
    catalog registers. Mirrors the ag-ui dynamic-schema reference example.

The ``composition_guide`` MUST describe the exact catalog the showcase page
registers at ``src/app/demos/declarative-gen-ui/a2ui/{definitions,renderers,
catalog}.ts`` (catalog id ``declarative-gen-ui-catalog``): the custom
components Card / StatusBadge / Metric / InfoRow / PrimaryButton / PieChart /
BarChart / DataTable, composed inside the basic catalog's Row / Column / Text
containers (``includeBasicCatalog: true``).
"""

from __future__ import annotations

from strands import Agent
from ag_ui_strands import StrandsAgent, StrandsAgentConfig

from agents.agent import _build_model

# Must match the catalog id the page registers via
# `createCatalog(..., { catalogId: "declarative-gen-ui-catalog" })`. The
# render planner omits `catalogId` unless told, and the middleware then falls
# back to the unregistered spec basic catalog ("Catalog not found"). Stamping
# it here (and in the route's `defaultCatalogId`) pins the right catalog.
CATALOG_ID = "declarative-gen-ui-catalog"

# Grounding dataset + composition rules for the sales-analyst persona, kept
# byte-for-byte in spirit with the frontend `sales-context.ts`
# (SALES_DATASET + COMPOSITION_RULES) that the page registers via
# `useAgentContext`. The frontend context steers the PRIMARY agent; this
# `composition_guide` is the channel the Strands adapter feeds to the secondary
# `render_a2ui` planner (it gets `guidelines`, not the frontend App Context),
# so the planner is self-contained — it knows both the numbers to ground in and
# which catalog components to compose.
SALES_DATASET = """Vantage Threads (fictional B2B apparel company) — Q2 sales data. Ground every visual in these numbers; invent only plausible details consistent with them.
- Quarterly revenue: $4.2M (up 12% QoQ). New customers: 186 (up 8%). Win rate: 31% (down 2pts). Avg deal size: $22.6k (up 5%).
- Revenue by region: North America $1.9M, EMEA $1.3M, APAC $720k, LATAM $280k.
- Monthly revenue: Jan $1.21M, Feb $1.34M, Mar $1.65M, Apr $1.38M, May $1.42M, Jun $1.40M.
- Reps (vs quota): Dana Whitfield 124%, Marcus Lee 108%, Priya Sharma 97%, Tom Okafor 88%, Elena Vasquez 71%.
- At-risk: total $615k ARR across 3 accounts — Northwind Retail ($340k renewal, no contact 6 weeks; severity high), Cascadia Outfitters ($180k, champion left; severity medium), Atlas Goods ($95k, stalled legal review; severity medium).
- Biggest account: Meridian Apparel Group — owner Dana Whitfield, region North America, ARR $612k, renewal Sep 30, last contact 3 days ago, health green, 4 open opportunities worth $210k.
- Meridian revenue by product line: Outerwear $260k, Footwear $180k, Accessories $112k, Custom $60k."""

COMPOSITION_RULES = """Use ONLY these exact component names (the registered catalog — any other name fails to render): Card, Column, Row, Text, Metric, PieChart, BarChart, DataTable, StatusBadge, InfoRow, PrimaryButton. The single-value KPI tile component is named exactly "Metric" (NOT "MetricTile" or "MetricCard").

Pick A2UI components by the shape of the question — never ask which chart the user wants:
1. Overall snapshot / "sales dashboard" → a Column (gap 16) whose first child is a Row (gap 16) of 4 Metric components (each with trend + trendValue), followed by a Row with a PieChart (revenue by region) next to a BarChart (monthly revenue, all six months Jan-Jun). Do NOT wrap the dashboard in a surrounding Card — the charts carry their own card chrome. Do NOT use StatusBadge, DataTable, or InfoRow here.
2. Rep / team performance → a Column (gap 16) with a Card containing a DataTable (columns: rep, attainment, pipeline) next to or above a BarChart of quota attainment % per rep — no StatusBadge or InfoRow.
3. Risk / health checks → a Column (gap 16): first a Row (gap 16) of 3 Metric components (ARR at risk $615k trend down, accounts at risk 3, biggest exposure Northwind $340k), then a Row (gap 16) with one compact Card per at-risk account (title = account name, subtitle = ARR at stake) containing a StatusBadge (error for high severity, warning otherwise) above a one-line Text with the reason and the recommended next action — no DataTable or InfoRow.
4. Single account/entity details → a Row (gap 16) with a Card of InfoRow facts (owner, region, ARR, renewal date, last contact) next to a PieChart of that account's revenue by product line — no DataTable or StatusBadge.
5. Part-of-whole follow-ups → PieChart; trends or comparisons over time/categories → BarChart.
Compose generously — a dashboard should feel like a real analytics product, not a single widget."""

COMPOSITION_GUIDE = SALES_DATASET + "\n\n" + COMPOSITION_RULES

# Mirrors the langgraph-python demo's a2ui_dynamic.py SYSTEM_PROMPT. The
# dataset + composition rules also reach the primary agent via the frontend
# `sales-context.ts` App Context.
SYSTEM_PROMPT = (
    "You are the embedded sales analyst for Vantage Threads, the fictional "
    "B2B apparel company described in your App Context. Answer every "
    "business question by calling `generate_a2ui` to draw a rich visual "
    "surface, and keep the chat reply to one short sentence.\n"
    "\n"
    "Ground every number in the sales dataset from App Context — never "
    "invent figures that contradict it. Follow the dashboard composition "
    "rules from App Context when choosing components: pick the component "
    "by the shape of the question (snapshot → composed KPI dashboard with "
    "charts; team performance → table; risk → status badges; single "
    "account → info rows; part-of-whole → pie; trend/comparison → bar). "
    "Never ask the user which chart they want. `generate_a2ui` takes no "
    "arguments and handles the rendering automatically. Compose "
    "generously — a dashboard should feel like a real analytics product, "
    "not a single widget."
)


def build_a2ui_dynamic_agent() -> StrandsAgent:
    """Construct the dedicated A2UI dynamic-schema StrandsAgent.

    The ``generate_a2ui`` tool is auto-injected by the adapter when the runtime
    forwards ``injectA2UITool: true`` — nothing is wired into the Strands
    agent's ``tools`` list here.
    """
    strands_agent = Agent(
        model=_build_model(),
        system_prompt=SYSTEM_PROMPT,
    )

    return StrandsAgent(
        agent=strands_agent,
        name="a2ui_dynamic_schema",
        description="Dynamic A2UI surfaces generated on the fly (auto-injected tool)",
        config=StrandsAgentConfig(
            a2ui={
                "default_catalog_id": CATALOG_ID,
                "guidelines": {"composition_guide": COMPOSITION_GUIDE},
            }
        ),
    )
