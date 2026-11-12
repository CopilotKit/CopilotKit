"use client";

import type { ReactNode } from "react";
import {
  SpendingTrendChart,
  BudgetUsageChart,
  SpendBreakdownChart,
  IncomeExpenseChart,
} from "@/skins/banking/components/analytics-charts";
import { TransactionsList } from "@/skins/banking/components/transactions-list";
import { isOverLimit } from "@/skins/banking/data/over-limit";
import { cn, formatCurrency } from "@/lib/utils";
import { useReportData } from "../report-data";

const GAP = { sm: "gap-2", md: "gap-4", lg: "gap-6", xl: "gap-10" } as const;

// Text props arrive resolved: the generative UI engine resolves a bound prop
// before render, and a binding that names nothing resolves to `undefined`. So
// coerce to a display string here.
type TextRef = string | undefined;
const asText = (value: TextRef): string =>
  typeof value === "string" ? value : "";

const Stack = (props: { children?: ReactNode; gap?: keyof typeof GAP }) => (
  <div className={cn("flex flex-col", GAP[props.gap ?? "md"])}>
    {props.children}
  </div>
);

const Row = (props: { children?: ReactNode; gap?: "sm" | "md" | "lg" }) => (
  <div className={cn("flex flex-wrap", GAP[props.gap ?? "md"])}>
    {props.children}
  </div>
);

const Grid = (props: { children?: ReactNode; columns?: number }) => (
  <div
    className="grid gap-4"
    style={{
      gridTemplateColumns: `repeat(${props.columns ?? 3}, minmax(0, 1fr))`,
    }}
  >
    {props.children}
  </div>
);

const Section = (props: { title: string; child?: ReactNode }) => (
  <section className="space-y-3">
    <h2 className="text-lg font-semibold text-ink">{props.title}</h2>
    {props.child}
  </section>
);

const Heading = (props: { text: TextRef }) => (
  <h1 className="text-2xl font-semibold tracking-tight text-ink">
    {asText(props.text)}
  </h1>
);

const Text = (props: { text: TextRef; tone?: "default" | "muted" }) => (
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

const StatCard = (props: {
  metric: "totalSpend" | "pendingCount" | "overLimitCount" | "policyCount";
  label: TextRef;
}) => {
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

const Chart = (props: {
  kind: "spendingTrend" | "budgetUsage" | "spendBreakdown" | "incomeVsExpenses";
}) => {
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

const Transactions = (props: {
  status?: "all" | "pending" | "approved" | "denied";
}) => {
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
