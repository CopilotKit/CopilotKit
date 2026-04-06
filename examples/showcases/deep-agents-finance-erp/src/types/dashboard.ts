export type WidgetType =
  | "kpi-cards"
  | "revenue-chart"
  | "expense-breakdown"
  | "recent-transactions"
  | "outstanding-invoices"
  | "custom-chart"
  | "cash-waterfall"
  | "ar-aging-gauge"
  | "budget-variance"
  | "spend-heatmap"
  | "revenue-forecast"
  | "metric-cards";

export interface BaseWidget {
  id: string;
  type: WidgetType;
  colSpan: 1 | 2 | 3 | 4;
  order: number;
}

export interface KpiCardsWidget extends BaseWidget {
  type: "kpi-cards";
  config: { metrics?: string[] };
}

export interface RevenueChartWidget extends BaseWidget {
  type: "revenue-chart";
  config: { showProfit?: boolean; showExpenses?: boolean };
}

export interface ExpenseBreakdownWidget extends BaseWidget {
  type: "expense-breakdown";
  config: { categories?: string[] };
}

export interface RecentTransactionsWidget extends BaseWidget {
  type: "recent-transactions";
  config: { limit?: number };
}

export interface OutstandingInvoicesWidget extends BaseWidget {
  type: "outstanding-invoices";
  config: { statuses?: ("pending" | "overdue")[] };
}

export interface CustomChartWidget extends BaseWidget {
  type: "custom-chart";
  config: {
    title: string;
    subtitle?: string;
    chartType: "area" | "bar" | "line";
    data: { label: string; value: number; value2?: number; value3?: number }[];
    series: { key: string; color: string; label: string }[];
    formatValues?: "currency" | "number" | "percent";
  };
}

export interface CashWaterfallWidget extends BaseWidget {
  type: "cash-waterfall";
  config: {
    title?: string;
    subtitle?: string;
    mode: "waterfall" | "flow-comparison";
    quarters?: number;
    showNetLine?: boolean;
    comparisonData?: { quarter: string; inflow: number; outflow: number }[];
  };
}

export interface ArAgingGaugeWidget extends BaseWidget {
  type: "ar-aging-gauge";
  config: {
    title?: string;
    warningThreshold?: number;
    criticalThreshold?: number;
  };
}

export interface BudgetVarianceWidget extends BaseWidget {
  type: "budget-variance";
  config: {
    title?: string;
    subtitle?: string;
    showPercentage?: boolean;
    categories?: string[];
  };
}

export interface SpendHeatmapWidget extends BaseWidget {
  type: "spend-heatmap";
  config: {
    title?: string;
    subtitle?: string;
    categories?: (
      | "payroll"
      | "operations"
      | "marketing"
      | "infrastructure"
      | "rnd"
      | "other"
    )[];
    colorScale?: "purple" | "blue" | "red";
  };
}

export interface RevenueForecastWidget extends BaseWidget {
  type: "revenue-forecast";
  config: {
    title?: string;
    subtitle?: string;
    mode: "forecast" | "quarterly";
    scenarios?: {
      label: string;
      values: { quarter: string; value: number }[];
      color: string;
    }[];
    trailingQuarters?: number;
    showMarginLine?: boolean;
  };
}

export interface MetricCardsWidget extends BaseWidget {
  type: "metric-cards";
  config: {
    metrics: string[];
    stacked?: boolean;
  };
}

export type DashboardWidget =
  | KpiCardsWidget
  | RevenueChartWidget
  | ExpenseBreakdownWidget
  | RecentTransactionsWidget
  | OutstandingInvoicesWidget
  | CustomChartWidget
  | CashWaterfallWidget
  | ArAgingGaugeWidget
  | BudgetVarianceWidget
  | SpendHeatmapWidget
  | RevenueForecastWidget
  | MetricCardsWidget;

export interface SavedDashboard {
  id: string;
  name: string;
  description?: string;
  category: "template" | "custom";
  widgets: DashboardWidget[];
  createdAt: string;
  updatedAt: string;
}
