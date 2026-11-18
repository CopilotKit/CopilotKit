"use client";

import { useState } from "react";
import { InlineChatChart } from "@/components/chat/inline-chart";
import { CashPositionCard } from "@/components/chat/cash-position-card";
import { InvoiceApprovalCard } from "@/components/chat/invoice-approval-card";
import { InventoryReorderCard } from "@/components/chat/inventory-reorder-card";
import { KPICard } from "@/components/ui/kpi-card";
import { RevenueChart } from "@/components/charts/revenue-chart";
import { ExpenseChart } from "@/components/charts/expense-chart";
import { DashboardCustomChart } from "@/components/dashboard/dashboard-custom-chart";
import { WidgetRenderer } from "@/components/dashboard/widget-renderer";
import { Badge } from "@/components/ui/badge";
import { ToolCallStatus } from "@copilotkit/react-core/v2";
import { kpis } from "@/lib/data";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const chartAreaArgs = {
  title: "Revenue Trend (FY2025)",
  type: "area" as const,
  data: [
    { label: "Q1", value: 628000, value2: 383000 },
    { label: "Q2", value: 696000, value2: 390000 },
    { label: "Q3", value: 851000, value2: 435000 },
    { label: "Q4", value: 951000, value2: 457000 },
  ],
  series: [
    { key: "value", color: "#2563eb", label: "Revenue" },
    { key: "value2", color: "#fb7185", label: "Expenses" },
  ],
};

const chartBarArgs = {
  title: "Expense Comparison by Quarter",
  type: "bar" as const,
  data: [
    { label: "Q1", value: 340000 },
    { label: "Q2", value: 355000 },
    { label: "Q3", value: 370000 },
    { label: "Q4", value: 390000 },
  ],
  series: [{ key: "value", color: "#8b5cf6", label: "Expenses" }],
};

const chartLineArgs = {
  title: "Cash Flow Forecast (Next 4 Quarters)",
  type: "line" as const,
  data: [
    { label: "Q2 2026", value: 410000, value2: 285000 },
    { label: "Q3 2026", value: 495000, value2: 320000 },
    { label: "Q4 2026", value: 598000, value2: 360000 },
    { label: "Q1 2027", value: 722000, value2: 405000 },
  ],
  series: [
    { key: "value", color: "#10b981", label: "Operating" },
    { key: "value2", color: "#f59e0b", label: "Net" },
  ],
};

const cashPositionArgs = {
  accounts: [
    { name: "Cash & Equivalents", balance: 1245000 },
    { name: "Accounts Receivable", balance: 456200 },
    { name: "Inventory", balance: 312400 },
  ],
  totalCash: 1245000,
  totalLiabilities: 904500,
  netPosition: 340500,
};

const invoiceApprovalArgs = {
  invoices: [
    {
      number: "INV-2026-003",
      client: "Initech LLC",
      amount: 67200,
      dueDate: "2026-03-15",
    },
    {
      number: "INV-2026-008",
      client: "Soylent Industries",
      amount: 34500,
      dueDate: "2026-03-01",
    },
    {
      number: "INV-2026-009",
      client: "Cyberdyne Systems",
      amount: 51800,
      dueDate: "2026-03-10",
    },
  ],
  totalAmount: 153500,
  action: "Process payment for 3 overdue invoices",
};

const inventoryReorderArgs = {
  items: [
    {
      sku: "HW-LAP-001",
      name: 'MacBook Pro 16"',
      currentQty: 3,
      reorderQty: 15,
      unitCost: 2499,
    },
    {
      sku: "HW-NET-001",
      name: "Cisco Catalyst 9300",
      currentQty: 0,
      reorderQty: 5,
      unitCost: 4200,
    },
    {
      sku: "HW-LAP-002",
      name: "ThinkPad X1 Carbon",
      currentQty: 8,
      reorderQty: 10,
      unitCost: 1849,
    },
  ],
  estimatedTotal: 76975,
  supplier: "CDW Direct",
};

const customChartConfig = {
  title: "Revenue Forecast — Scenario Analysis",
  chartType: "line" as const,
  data: [
    { label: "Q2 2026", value: 1050000, value2: 870000 },
    { label: "Q3 2026", value: 1160000, value2: 920000 },
    { label: "Q4 2026", value: 1280000, value2: 975000 },
    { label: "Q1 2027", value: 1150000, value2: 840000 },
  ],
  series: [
    { key: "value", color: "#10b981", label: "Optimistic" },
    { key: "value2", color: "#f59e0b", label: "Conservative" },
  ],
};

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolMeta {
  id: string;
  label: string;
  toolName: string;
  hook: "useFrontendTool" | "useHumanInTheLoop";
  category: "chat" | "dashboard" | "management";
  description: string;
  parameters: ToolParam[];
  hasVisual: boolean;
  /** Bento grid column span (out of 4) */
  colSpan: number;
}

const TOOL_REGISTRY: ToolMeta[] = [
  // ---- Chat-rendered ----
  {
    id: "render_chart",
    label: "Inline Chart",
    toolName: "render_chart",
    hook: "useFrontendTool",
    category: "chat",
    description:
      "Render an interactive chart directly in the chat. Use this when the user asks for visualizations, projections, or trends. Choose the best chart type: 'area' for trends over time, 'bar' for comparisons, 'line' for trajectories.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Chart title",
      },
      {
        name: "type",
        type: '"area" | "bar" | "line"',
        required: true,
        description:
          "Chart type: area for trends, bar for comparisons, line for trajectories",
      },
      {
        name: "data",
        type: "{ label: string; value: number; value2?: number }[]",
        required: true,
        description:
          "Chart data points. Each point has a label (x-axis) and one or two values.",
      },
      {
        name: "series",
        type: "{ key: string; color: string; label: string }[]",
        required: true,
        description:
          'Series config. key is "value" or "value2", color is a hex string, label is the legend text.',
      },
    ],
  },
  {
    id: "render_cash_position",
    label: "Cash Position",
    toolName: "render_cash_position",
    hook: "useFrontendTool",
    category: "chat",
    description:
      "Render a cash position summary card in the chat showing cash accounts, liabilities, and net position. You MUST call this tool whenever the user asks about cash position, liquidity, or cash vs liabilities — always render the card instead of describing numbers in text.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "accounts",
        type: "{ name: string; balance: number }[]",
        required: true,
        description: "Cash and asset accounts to display",
      },
      {
        name: "totalCash",
        type: "number",
        required: true,
        description: "Total cash and cash equivalents",
      },
      {
        name: "totalLiabilities",
        type: "number",
        required: true,
        description: "Total liabilities",
      },
      {
        name: "netPosition",
        type: "number",
        required: true,
        description: "Net position (totalCash - totalLiabilities)",
      },
    ],
  },
  {
    id: "approve_invoice_payment",
    label: "Invoice Approval",
    toolName: "approve_invoice_payment",
    hook: "useHumanInTheLoop",
    category: "chat",
    description:
      "Present overdue or pending invoices to the user for payment approval. The agent MUST use this tool before marking any invoice as paid. Never process payments without explicit user approval.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "invoices",
        type: "{ number: string; client: string; amount: number; dueDate: string }[]",
        required: true,
        description: "Invoices to present for payment approval",
      },
      {
        name: "totalAmount",
        type: "number",
        required: true,
        description: "Sum of all invoice amounts",
      },
      {
        name: "action",
        type: "string",
        required: true,
        description:
          "Description of the action, e.g. 'Mark 3 invoices as paid'",
      },
    ],
  },
  {
    id: "approve_inventory_reorder",
    label: "Inventory Reorder",
    toolName: "approve_inventory_reorder",
    hook: "useHumanInTheLoop",
    category: "chat",
    description:
      "Present a purchase order for low-stock or out-of-stock items. The agent MUST use this tool before placing any reorder. Wait for user approval before proceeding.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "items",
        type: "{ sku: string; name: string; currentQty: number; reorderQty: number; unitCost: number }[]",
        required: true,
        description: "Items to reorder with current stock and order quantities",
      },
      {
        name: "estimatedTotal",
        type: "number",
        required: true,
        description: "Total estimated cost of the purchase order",
      },
      {
        name: "supplier",
        type: "string",
        required: false,
        description: "Supplier name, if known",
      },
    ],
  },

  // ---- Dashboard widgets ----
  {
    id: "render_kpi_cards",
    label: "KPI Cards",
    toolName: "render_kpi_cards",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add or update KPI metric cards on the dashboard. Shows key financial metrics like Total Revenue, Net Profit, Accounts Receivable, and Operating Expenses.",
    hasVisual: true,
    colSpan: 4,
    parameters: [
      {
        name: "metrics",
        type: "string[]",
        required: false,
        description:
          "Which KPI labels to show. Options: 'Total Revenue', 'Net Profit', 'Accounts Receivable', 'Operating Expenses'. Omit to show all.",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 4 (full width)",
      },
    ],
  },
  {
    id: "render_revenue_chart",
    label: "Revenue Chart",
    toolName: "render_revenue_chart",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add or update the Revenue vs Expenses area chart on the dashboard. Shows monthly revenue, expenses, and profit trends.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "showProfit",
        type: "boolean",
        required: false,
        description: "Show the profit line. Default: true",
      },
      {
        name: "showExpenses",
        type: "boolean",
        required: false,
        description: "Show the expenses line. Default: true",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 3",
      },
    ],
  },
  {
    id: "render_expense_breakdown",
    label: "Expense Breakdown",
    toolName: "render_expense_breakdown",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add or update the Expense Breakdown widget on the dashboard. Shows expenses by category with progress bars.",
    hasVisual: true,
    colSpan: 1,
    parameters: [
      {
        name: "categories",
        type: "string[]",
        required: false,
        description:
          "Filter to specific categories. Options: 'Payroll', 'Operations', 'Marketing', 'Infrastructure', 'R&D', 'Other'. Omit to show all.",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 1",
      },
    ],
  },
  {
    id: "render_transactions",
    label: "Transactions",
    toolName: "render_transactions",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add or update the Recent Transactions table on the dashboard. Shows the latest financial transactions with descriptions, amounts, and status.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "limit",
        type: "number (1-20)",
        required: false,
        description: "Number of transactions to display. Default: 5",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 2",
      },
    ],
  },
  {
    id: "render_invoices",
    label: "Outstanding Invoices",
    toolName: "render_invoices",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add or update the Outstanding Invoices table on the dashboard. Shows invoices filtered by status with amounts and due dates.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "statuses",
        type: '("pending" | "overdue")[]',
        required: false,
        description: "Which statuses to show. Default: ['pending', 'overdue']",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 2",
      },
    ],
  },
  {
    id: "render_custom_chart",
    label: "Custom Chart",
    toolName: "render_custom_chart",
    hook: "useFrontendTool",
    category: "dashboard",
    description:
      "Add a custom chart to the dashboard with agent-provided data. Use this when the user wants a new visualization on their dashboard (forecasts, projections, custom analysis). Each call creates a new chart widget.",
    hasVisual: true,
    colSpan: 2,
    parameters: [
      {
        name: "title",
        type: "string",
        required: true,
        description: "Chart title displayed on the dashboard card",
      },
      {
        name: "chartType",
        type: '"area" | "bar" | "line"',
        required: true,
        description:
          "Chart type: area for trends, bar for comparisons, line for trajectories",
      },
      {
        name: "data",
        type: "{ label: string; value: number; value2?: number }[]",
        required: true,
        description: "Chart data points",
      },
      {
        name: "series",
        type: "{ key: string; color: string; label: string }[]",
        required: true,
        description: "Series config for the chart",
      },
      {
        name: "colSpan",
        type: "1 | 2 | 3 | 4",
        required: false,
        description: "Grid column span. Default: 2",
      },
    ],
  },

  // ---- Management tools ----
  {
    id: "remove_dashboard_widget",
    label: "Remove Widget",
    toolName: "remove_dashboard_widget",
    hook: "useFrontendTool",
    category: "management",
    description:
      "Remove a widget from the dashboard by its ID. Check the current dashboard layout context to find widget IDs.",
    hasVisual: false,
    colSpan: 1,
    parameters: [
      {
        name: "widgetId",
        type: "string",
        required: true,
        description: "The ID of the widget to remove",
      },
    ],
  },
  {
    id: "update_dashboard_layout",
    label: "Update Layout",
    toolName: "update_dashboard_layout",
    hook: "useFrontendTool",
    category: "management",
    description:
      "Reorder or resize multiple dashboard widgets at once. Provide an array of updates with widgetId and optional new colSpan or order values.",
    hasVisual: false,
    colSpan: 1,
    parameters: [
      {
        name: "updates",
        type: "{ widgetId: string; colSpan?: 1|2|3|4; order?: number }[]",
        required: true,
        description:
          "Array of widget updates — each specifies a widgetId and optional new colSpan or order",
      },
    ],
  },
  {
    id: "reset_dashboard",
    label: "Reset Dashboard",
    toolName: "reset_dashboard",
    hook: "useFrontendTool",
    category: "management",
    description:
      "Reset the dashboard to its default layout with all standard widgets: KPI cards, Revenue chart, Expense breakdown, Recent transactions, and Outstanding invoices.",
    hasVisual: false,
    colSpan: 1,
    parameters: [],
  },
  {
    id: "navigate_and_filter",
    label: "Navigate & Filter",
    toolName: "navigate_and_filter",
    hook: "useFrontendTool",
    category: "management",
    description:
      "Navigate to an ERP page and optionally apply a filter. Use this when the user asks to see specific data (e.g. 'show me overdue invoices', 'go to inventory').",
    hasVisual: false,
    colSpan: 1,
    parameters: [
      {
        name: "page",
        type: '"dashboard" | "invoices" | "accounts" | "inventory" | "hr"',
        required: true,
        description: "Page to navigate to",
      },
      {
        name: "filter",
        type: "string",
        required: false,
        description:
          "Filter to apply. Invoices: paid|pending|overdue|draft. Inventory: in-stock|low-stock|out-of-stock. HR: department name.",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Category labels
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  chat: "Chat-rendered",
  dashboard: "Dashboard Widgets",
  management: "Management Tools",
};

// ---------------------------------------------------------------------------
// Helper: how-it-works text
// ---------------------------------------------------------------------------

function howItWorks(tool: ToolMeta): string {
  if (tool.hook === "useHumanInTheLoop") {
    return "The agent emits a tool call with the parameters above. CopilotKit matches it to this frontend tool and renders the approval card in chat. The card stays in 'executing' state until the user clicks Approve or Reject. The user's decision is sent back to the agent as the tool result, so the agent can proceed accordingly.";
  }
  if (tool.category === "chat") {
    return "The agent emits a tool call with the parameters above. CopilotKit matches it to this frontend tool and renders the component inline in the chat message stream. The handler returns a confirmation result to the agent.";
  }
  if (tool.category === "dashboard") {
    return "The agent emits a tool call with the parameters above. CopilotKit matches it to this frontend tool, whose handler calls the dashboard context to add or update the widget on the canvas. The dashboard re-renders immediately with the new/updated widget. A result is returned to the agent confirming the action.";
  }
  return "The agent emits a tool call with the parameters above. CopilotKit matches it to this frontend tool, which executes the action (e.g. navigation, layout change) and returns a result to the agent.";
}

// ---------------------------------------------------------------------------
// Bento card preview — compact preview for each tool in the grid
// ---------------------------------------------------------------------------

function BentoPreview({ toolId }: { toolId: string }) {
  switch (toolId) {
    case "render_chart":
      return <InlineChatChart args={chartAreaArgs} status="complete" />;
    case "render_cash_position":
      return <CashPositionCard args={cashPositionArgs} status="complete" />;
    case "approve_invoice_payment":
      return (
        <InvoiceApprovalCard
          status={ToolCallStatus.Executing}
          args={invoiceApprovalArgs}
          respond={async () => {}}
          result={undefined}
        />
      );
    case "approve_inventory_reorder":
      return (
        <InventoryReorderCard
          status={ToolCallStatus.Executing}
          args={inventoryReorderArgs}
          respond={async () => {}}
          result={undefined}
        />
      );
    case "render_kpi_cards":
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi) => (
            <KPICard key={kpi.label} kpi={kpi} />
          ))}
        </div>
      );
    case "render_revenue_chart":
      return <RevenueChart />;
    case "render_expense_breakdown":
      return <ExpenseChart />;
    case "render_transactions":
      return (
        <WidgetRenderer
          widget={{
            id: "demo-txn",
            type: "recent-transactions",
            colSpan: 4,
            order: 0,
            config: { limit: 3 },
          }}
        />
      );
    case "render_invoices":
      return (
        <WidgetRenderer
          widget={{
            id: "demo-inv",
            type: "outstanding-invoices",
            colSpan: 4,
            order: 0,
            config: {},
          }}
        />
      );
    case "render_custom_chart":
      return <DashboardCustomChart config={customChartConfig} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Full preview for detail view (shows all variants / states)
// ---------------------------------------------------------------------------

function FullPreview({ toolId }: { toolId: string }) {
  switch (toolId) {
    case "render_chart":
      return (
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Area variant
            </p>
            <InlineChatChart args={chartAreaArgs} status="complete" />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Bar variant
            </p>
            <InlineChatChart args={chartBarArgs} status="complete" />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Line variant
            </p>
            <InlineChatChart args={chartLineArgs} status="complete" />
          </div>
        </div>
      );
    case "approve_invoice_payment":
      return (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Executing state (awaiting user decision)
            </p>
            <InvoiceApprovalCard
              status={ToolCallStatus.Executing}
              args={invoiceApprovalArgs}
              respond={async (result) => alert(JSON.stringify(result, null, 2))}
              result={undefined}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Completed state (approved)
            </p>
            <InvoiceApprovalCard
              status={ToolCallStatus.Complete}
              args={invoiceApprovalArgs}
              respond={undefined}
              result="Payment approved for 2 invoices"
            />
          </div>
        </div>
      );
    case "approve_inventory_reorder":
      return (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Executing state (awaiting user decision)
            </p>
            <InventoryReorderCard
              status={ToolCallStatus.Executing}
              args={inventoryReorderArgs}
              respond={async (result) => alert(JSON.stringify(result, null, 2))}
              result={undefined}
            />
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Completed state (approved)
            </p>
            <InventoryReorderCard
              status={ToolCallStatus.Complete}
              args={inventoryReorderArgs}
              respond={undefined}
              result="PO approved for 3 items"
            />
          </div>
        </div>
      );
    default:
      return <BentoPreview toolId={toolId} />;
  }
}

// ---------------------------------------------------------------------------
// Bento card — a single card in the grid
// ---------------------------------------------------------------------------

function BentoCard({ tool, onClick }: { tool: ToolMeta; onClick: () => void }) {
  const spanClass =
    tool.colSpan === 4
      ? "col-span-1 sm:col-span-2 lg:col-span-4"
      : tool.colSpan === 3
        ? "col-span-1 sm:col-span-2 lg:col-span-3"
        : tool.colSpan === 2
          ? "col-span-1 sm:col-span-2"
          : "col-span-1";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={`${spanClass} group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card text-left transition-all hover:border-foreground/20 hover:shadow-lg`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 p-4 pb-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            {tool.label}
          </h3>
          <code className="text-[11px] text-muted-foreground">
            {tool.toolName}
          </code>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {tool.hook === "useHumanInTheLoop" ? "HITL" : "frontend"}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {CATEGORY_LABELS[tool.category]}
          </Badge>
        </div>
      </div>

      {/* Description */}
      <p className="px-4 text-xs leading-relaxed text-muted-foreground line-clamp-2">
        {tool.description}
      </p>

      {/* Preview or param summary */}
      {tool.hasVisual ? (
        <div className="mt-3 flex-1 overflow-hidden px-4 pb-4">
          <div className="pointer-events-none origin-top-left">
            <BentoPreview toolId={tool.id} />
          </div>
        </div>
      ) : (
        <div className="mt-3 flex-1 px-4 pb-4">
          <div className="space-y-1.5">
            {tool.parameters.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No parameters
              </p>
            ) : (
              tool.parameters.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <code className="text-[11px] text-foreground">{p.name}</code>
                  <span className="text-[10px] text-muted-foreground">
                    {p.type}
                  </span>
                  {p.required && (
                    <Badge variant="default" className="text-[9px] px-1 py-0">
                      req
                    </Badge>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Hover hint */}
      <div className="absolute inset-x-0 bottom-0 flex h-10 items-end justify-center bg-gradient-to-t from-card to-transparent pb-2 opacity-0 transition-opacity group-hover:opacity-100">
        <span className="rounded-full bg-foreground/10 px-3 py-1 text-[10px] font-medium text-foreground">
          View details
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view — full usage guide for a single tool
// ---------------------------------------------------------------------------

function DetailView({ tool, onBack }: { tool: ToolMeta; onBack: () => void }) {
  return (
    <div className="space-y-6">
      {/* Back + header */}
      <div>
        <button
          onClick={onBack}
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg bg-card border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className="shrink-0"
          >
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          All components
        </button>
        <h2 className="text-2xl font-bold text-foreground">{tool.label}</h2>
        <div className="mt-2 flex gap-2">
          <Badge variant="secondary">{tool.hook}</Badge>
          <Badge variant="outline">{CATEGORY_LABELS[tool.category]}</Badge>
        </div>
      </div>

      {/* Preview */}
      {tool.hasVisual && (
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="mb-4 text-sm font-semibold text-foreground">
            Preview
          </h3>
          <FullPreview toolId={tool.id} />
        </div>
      )}

      {/* Usage guide */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <h3 className="text-sm font-semibold text-foreground">Usage Guide</h3>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Tool name</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {tool.toolName}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Registered via</p>
            <p className="mt-1 font-mono text-sm text-foreground">
              {tool.hook}
            </p>
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Agent description</p>
          <p className="mt-1 rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed text-foreground/80">
            {tool.description}
          </p>
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Parameters</p>
          {tool.parameters.length === 0 ? (
            <p className="mt-2 text-sm italic text-muted-foreground">
              No parameters
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">Name</th>
                    <th className="pb-2 pr-4 font-medium">Type</th>
                    <th className="pb-2 pr-4 font-medium">Required</th>
                    <th className="pb-2 font-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {tool.parameters.map((p) => (
                    <tr
                      key={p.name}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-2 pr-4 font-mono text-foreground">
                        {p.name}
                      </td>
                      <td className="py-2 pr-4 font-mono text-muted-foreground">
                        {p.type}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge
                          variant={p.required ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {p.required ? "required" : "optional"}
                        </Badge>
                      </td>
                      <td className="py-2 text-muted-foreground">
                        {p.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-muted-foreground">
            How CopilotKit calls this tool
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {howItWorks(tool)}
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — bento grid overview with click-to-detail
// ---------------------------------------------------------------------------

export default function ComponentsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedTool = TOOL_REGISTRY.find((t) => t.id === selectedId);

  const categories = ["chat", "dashboard", "management"] as const;

  return (
    <div className="min-h-screen bg-muted px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-heading text-2xl font-bold text-foreground sm:text-3xl">
            Frontend Tool Components
          </h1>
          <p className="mt-2 text-muted-foreground">
            {selectedTool
              ? "Detailed usage guide and preview."
              : "All components registered as frontend tools. Click any card to see its usage guide."}
          </p>
        </div>

        {selectedTool ? (
          <DetailView tool={selectedTool} onBack={() => setSelectedId(null)} />
        ) : (
          <div className="space-y-10">
            {categories.map((cat) => {
              const tools = TOOL_REGISTRY.filter((t) => t.category === cat);
              return (
                <div key={cat}>
                  <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {CATEGORY_LABELS[cat]}
                  </h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {tools.map((tool) => (
                      <BentoCard
                        key={tool.id}
                        tool={tool}
                        onClick={() => setSelectedId(tool.id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
