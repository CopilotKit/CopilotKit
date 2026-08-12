"use client";

import useCreditCards from "@/app/actions";
import {
  SpendingTrendChart,
  BudgetUsageChart,
  SpendBreakdownChart,
  IncomeExpenseChart,
} from "@/components/analytics-charts";
import { ChartCard } from "./chart-pills";

/**
 * The dashboard's Analytics tab: the four brand charts (previously summonable
 * only inside the chat) rendered as a dashboard view, each carrying its own
 * conversation-starter pills. Every question a viewer might ask of a chart is
 * one click away — no typing.
 */
export function AnalyticsView() {
  const { policies, transactions } = useCreditCards();

  return (
    <div className="grid gap-5 md:grid-cols-2">
      <ChartCard
        title="Spending trend"
        pills={[
          {
            label: "Explain this spike",
            message:
              "Looking at the spending trend chart on the Analytics tab: explain the biggest spike — which transactions caused it?",
          },
          {
            label: "Summarize the trend",
            message:
              "Summarize the spending trend over time in a couple of sentences. What should I be paying attention to?",
          },
        ]}
      >
        <SpendingTrendChart transactions={transactions} />
      </ChartCard>

      <ChartCard
        title="Budget usage by policy"
        pills={[
          {
            label: "Who's closest to their limit?",
            message:
              "Looking at the budget usage chart: which expense policy is closest to its limit, and what's driving that usage?",
          },
          {
            label: "Anything over budget?",
            message:
              "Are any expense policies over their limit, or at risk of going over? Show me the budget usage.",
          },
        ]}
      >
        <BudgetUsageChart policies={policies} />
      </ChartCard>

      <ChartCard
        title="Spend breakdown"
        pills={[
          {
            label: "Where is the money going?",
            message:
              "Looking at the spend breakdown chart: where is most of the money going, by team?",
          },
          {
            label: "Which team drove this?",
            message:
              "Which team drove the most spend, and which transactions were the biggest contributors?",
          },
        ]}
      >
        <SpendBreakdownChart policies={policies} />
      </ChartCard>

      <ChartCard
        title="Income vs expenses"
        pills={[
          {
            label: "Explain our net position",
            message:
              "Looking at the income vs expenses chart: explain our net position in plain terms.",
          },
          {
            label: "How's our cash flow?",
            message:
              "How does our income compare to our expenses right now, and is anything unusual?",
          },
        ]}
      >
        <IncomeExpenseChart transactions={transactions} />
      </ChartCard>
    </div>
  );
}

export default AnalyticsView;
