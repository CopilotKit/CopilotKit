"use client";

import type { RendererProps } from "@copilotkit/a2ui-renderer";
import {
  SpendingTrendChart,
  BudgetUsageChart,
  SpendBreakdownChart,
  IncomeExpenseChart,
} from "@/components/analytics-charts";
import { TransactionsList } from "@/components/transactions-list";
import { isOverLimit } from "@/lib/over-limit";
import { cn, formatCurrency } from "@/lib/utils";
import { useReportData } from "../report-data";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props in the catalog are `string | { path }` (a data-bound ref). The
// A2UI runtime resolves refs before render, but the Zod-inferred type still
// carries the union, so coerce to a display string here.
type TextRef = string | { path: string };
const asText = (value: TextRef): string =>
  typeof value === "string" ? value : "";

function Slot({ render }: { render: React.ReactNode }) {
  return <>{render}</>;
}

const Stack = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: keyof typeof GAP }>) => (
  <div className={cn("flex flex-col", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Row = ({
  props,
  children,
}: RendererProps<{ children: string[]; gap?: "sm" | "md" | "lg" }>) => (
  <div className={cn("flex flex-wrap", GAP[props.gap ?? "md"])}>
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Grid = ({
  props,
  children,
}: RendererProps<{ children: string[]; columns?: number }>) => (
  <div
    className="grid gap-4"
    style={{
      gridTemplateColumns: `repeat(${props.columns ?? 3}, minmax(0, 1fr))`,
    }}
  >
    {props.children?.map((id) => (
      <Slot key={id} render={children(id)} />
    ))}
  </div>
);

const Section = ({
  props,
  children,
}: RendererProps<{ title: string; child: string }>) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
    <Slot render={children(props.child)} />
  </section>
);

const Heading = ({ props }: RendererProps<{ text: TextRef }>) => (
  <h1 className="text-2xl font-semibold tracking-tight text-ink">
    {asText(props.text)}
  </h1>
);

const Text = ({
  props,
}: RendererProps<{ text: TextRef; tone?: "default" | "muted" }>) => (
  <p
    className={cn(
      "text-sm",
      props.tone === "muted" ? "text-ink-muted" : "text-ink",
    )}
  >
    {asText(props.text)}
  </p>
);

function CardShell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
      <div className="text-xs uppercase tracking-wide text-ink-muted">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
    </div>
  );
}

const StatCard = ({
  props,
}: RendererProps<{
  metric: "totalSpend" | "pendingCount" | "overLimitCount" | "policyCount";
  label: TextRef;
}>) => {
  const { transactions, policies } = useReportData();
  const pending = transactions.filter((t) => t.status === "pending");
  let value = "";
  switch (props.metric) {
    case "totalSpend":
      value = formatCurrency(
        transactions
          .filter((t) => t.status === "approved")
          .reduce((sum, t) => sum + Math.abs(t.amount), 0),
      );
      break;
    case "pendingCount":
      value = String(pending.length);
      break;
    case "overLimitCount":
      value = String(pending.filter((t) => isOverLimit(t, policies)).length);
      break;
    case "policyCount":
      value = String(policies.length);
      break;
  }
  return <CardShell label={asText(props.label)} value={value} />;
};

const Chart = ({
  props,
}: RendererProps<{
  kind: "spendingTrend" | "budgetUsage" | "spendBreakdown" | "incomeVsExpenses";
}>) => {
  const { transactions, policies } = useReportData();
  const inner = (() => {
    switch (props.kind) {
      case "spendingTrend":
        return <SpendingTrendChart transactions={transactions} />;
      case "budgetUsage":
        return <BudgetUsageChart policies={policies} />;
      case "spendBreakdown":
        return <SpendBreakdownChart policies={policies} />;
      case "incomeVsExpenses":
        return <IncomeExpenseChart transactions={transactions} />;
    }
  })();
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4 shadow-soft">
      {inner}
    </div>
  );
};

const Transactions = ({
  props,
}: RendererProps<{ status?: "all" | "pending" | "approved" | "denied" }>) => {
  const { transactions, policies } = useReportData();
  const status = props.status ?? "all";
  const rows =
    status === "all"
      ? transactions
      : transactions.filter((t) => t.status === status);
  if (!rows.length) {
    return (
      <div className="rounded-2xl border border-hairline bg-surface p-4 text-sm text-ink-muted">
        {status === "all" ? "No transactions." : `No ${status} transactions.`}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-hairline bg-surface p-4">
      <TransactionsList transactions={rows} policies={policies} />
    </div>
  );
};

export const renderers = {
  Stack,
  Row,
  Grid,
  Section,
  Heading,
  Text,
  StatCard,
  Chart,
  Transactions,
};
