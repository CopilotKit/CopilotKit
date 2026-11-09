import type { DashboardWidget } from "@/types/dashboard";
import sql from "./db";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function ensureSchema() {
  if (!sql) return;

  await sql`
    CREATE TABLE IF NOT EXISTS dashboards (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      description TEXT,
      category   TEXT NOT NULL DEFAULT 'custom',
      widgets    JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Seed templates if none exist
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM dashboards WHERE category = 'template'
  `;
  if (count === 0) {
    await seedTemplates();
  }
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

export const TEMPLATES: {
  name: string;
  description: string;
  widgets: DashboardWidget[];
}[] = [
  {
    name: "Executive Summary",
    description:
      "High-level overview with KPIs, revenue trends, expenses, recent transactions, and outstanding invoices. The default starting layout.",
    widgets: [
      { id: "kpi-cards", type: "kpi-cards", colSpan: 4, order: 0, config: {} },
      {
        id: "revenue-chart",
        type: "revenue-chart",
        colSpan: 3,
        order: 1,
        config: { showProfit: true, showExpenses: true },
      },
      {
        id: "expense-breakdown",
        type: "expense-breakdown",
        colSpan: 1,
        order: 2,
        config: {},
      },
      {
        id: "recent-transactions",
        type: "recent-transactions",
        colSpan: 2,
        order: 3,
        config: { limit: 5 },
      },
      {
        id: "outstanding-invoices",
        type: "outstanding-invoices",
        colSpan: 2,
        order: 4,
        config: { statuses: ["pending", "overdue"] },
      },
    ],
  },
  {
    name: "Cash Flow Risk",
    description:
      "Liquidity war room — waterfall chart for cash flow components, AR aging gauge with collection rate, and inflow vs outflow comparison.",
    widgets: [
      // Row 1: Waterfall hero (3-col) + expense breakdown sidebar (1-col)
      {
        id: "cash-waterfall",
        type: "cash-waterfall",
        colSpan: 3,
        order: 0,
        config: { mode: "waterfall", showNetLine: true },
      },
      {
        id: "expense-breakdown",
        type: "expense-breakdown",
        colSpan: 1,
        order: 1,
        config: {},
      },
      // Row 2: Metric cards (2-col) + AR aging gauge (2-col)
      {
        id: "metric-cards",
        type: "metric-cards",
        colSpan: 2,
        order: 2,
        config: { metrics: ["Total Revenue", "Accounts Receivable"] },
      },
      {
        id: "ar-aging-gauge",
        type: "ar-aging-gauge",
        colSpan: 2,
        order: 3,
        config: {},
      },
      // Row 3: Overdue invoices (2-col) + flow comparison butterfly bars (2-col)
      {
        id: "outstanding-invoices",
        type: "outstanding-invoices",
        colSpan: 2,
        order: 4,
        config: { statuses: ["overdue"] },
      },
      {
        id: "cash-flow-comparison",
        type: "cash-waterfall",
        colSpan: 2,
        order: 5,
        config: { mode: "flow-comparison" },
      },
    ],
  },
  {
    name: "Cost Control",
    description:
      "Budget-focused command center — diverging variance analysis, spend intensity heatmap, and expense breakdown by category.",
    widgets: [
      // Row 1: Budget variance diverging bars — full-width hero
      {
        id: "budget-variance",
        type: "budget-variance",
        colSpan: 4,
        order: 0,
        config: {},
      },
      // Row 2: Spend heatmap (3-col) + metric cards sidebar stacked (1-col)
      {
        id: "spend-heatmap",
        type: "spend-heatmap",
        colSpan: 3,
        order: 1,
        config: {},
      },
      {
        id: "metric-cards",
        type: "metric-cards",
        colSpan: 1,
        order: 2,
        config: {
          metrics: ["Operating Expenses", "Net Profit"],
          stacked: true,
        },
      },
      // Row 3: Expense breakdown (2-col) + recent transactions (2-col)
      {
        id: "expense-breakdown",
        type: "expense-breakdown",
        colSpan: 2,
        order: 3,
        config: {},
      },
      {
        id: "recent-transactions",
        type: "recent-transactions",
        colSpan: 2,
        order: 4,
        config: { limit: 5 },
      },
    ],
  },
  {
    name: "Revenue Overview",
    description:
      "Growth narrative for leadership — full revenue timeline, scenario forecast with confidence bands, quarterly profit margin analysis, and pipeline health.",
    widgets: [
      // Row 1: All four KPIs — full context before the deep dive
      {
        id: "kpi-cards",
        type: "kpi-cards",
        colSpan: 4,
        order: 0,
        config: {},
      },
      // Row 2: Hero revenue chart — the main story, full width
      {
        id: "revenue-chart",
        type: "revenue-chart",
        colSpan: 4,
        order: 1,
        config: { showProfit: true, showExpenses: true },
      },
      // Row 3: Fan forecast (2-col) + quarterly bar+line (2-col)
      {
        id: "revenue-forecast-chart",
        type: "revenue-forecast",
        colSpan: 2,
        order: 2,
        config: { mode: "forecast" },
      },
      {
        id: "quarterly-revenue-chart",
        type: "revenue-forecast",
        colSpan: 2,
        order: 3,
        config: { mode: "quarterly", showMarginLine: true },
      },
      // Row 4: Pipeline invoices (3-col) + expense sidebar (1-col)
      {
        id: "outstanding-invoices",
        type: "outstanding-invoices",
        colSpan: 3,
        order: 4,
        config: { statuses: ["pending", "overdue"] },
      },
      {
        id: "expense-breakdown",
        type: "expense-breakdown",
        colSpan: 1,
        order: 5,
        config: {},
      },
    ],
  },
];

async function seedTemplates() {
  if (!sql) return;
  for (const t of TEMPLATES) {
    await sql`
      INSERT INTO dashboards (name, description, category, widgets)
      VALUES (${t.name}, ${t.description}, 'template', ${JSON.stringify(t.widgets)})
    `;
  }
}
