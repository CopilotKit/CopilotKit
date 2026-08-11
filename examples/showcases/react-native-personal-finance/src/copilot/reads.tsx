/**
 * Read-only CopilotKit frontend tools for the finance demo.
 *
 * `<FinanceReadTools/>` registers four frontend tools the agent can call to
 * ground its answers in the *current* store state. None of them mutate
 * anything, so they need no approval and resolve synchronously.
 *
 * Each tool registers BOTH a `handler` (returns JSON for the agent to reason
 * over) and a `render` function (shows generative UI in chat: lists, bars,
 * and a real SVG donut chart). The agent sees the JSON; the user sees the
 * card. The agent text and the card render side-by-side in the transcript.
 *
 * SDK API used (see node_modules/@copilotkit/react-native + react-core v2):
 *   useFrontendTool<T>(tool: ReactFrontendTool<T>, deps?): void
 *   where ReactFrontendTool<T> = FrontendTool<T> & {
 *     render?: React.ComponentType<{ name; toolCallId; args; status; result? }>
 *   }
 */

import { z } from "zod";
import { useFrontendTool } from "@copilotkit/react-native";
import { TOOLS } from "./contracts";
import {
  useFinanceStore,
  recentTransactions,
  topExpenses,
  spendByCategoryThisMonth,
  budgetSpent,
} from "../store/financeStore";
import type { Account, CurrencyCode, Transaction } from "../types";
import {
  AccountsResultCard,
  BudgetsResultCard,
  TransactionsResultCard,
  TopExpensesResultCard,
} from "./ResultCards";
import { SpendDonut } from "./SpendDonut";

/**
 * Type-erase the render prop for a read tool. The SDK's render union is
 * discriminated by `status`; we just need to render once `args` is present
 * (frontend tools resolve quickly, so we render on every status with the
 * data we have).
 */
type ReadRenderProps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result?: any;
  status: string;
};

/**
 * Registers the read-only grounding tools and their in-chat renders.
 * Renders nothing itself — it only calls the registration hooks. Mount it
 * once under the CopilotKitProvider.
 */
export function FinanceReadTools(): null {
  // --- getAccounts: every account with its live balance ----------------------
  useFrontendTool({
    name: TOOLS.getAccounts,
    description:
      "List the user's financial accounts with their current balances and " +
      "currencies. Call this to ground answers about balances, net worth, or " +
      "which accounts exist before adding a transaction.",
    parameters: z.object({}),
    handler: async () => {
      const { accounts, baseCurrency } = useFinanceStore.getState();
      return {
        baseCurrency,
        accounts: accounts.map((acc) => ({
          id: acc.id,
          name: acc.name,
          type: acc.type,
          currency: acc.currency,
          balance: acc.balance,
          icon: acc.icon,
        })),
      };
    },
    render: (_props: ReadRenderProps) => {
      // Read live store state at render time so a fresh balance shows even
      // after the chat has committed a new transaction.
      const accounts: Account[] = useFinanceStore.getState().accounts;
      return <AccountsResultCard accounts={accounts} />;
    },
  });

  // --- getBudgets: monthly budgets ------------------------------------------
  useFrontendTool({
    name: TOOLS.getBudgets,
    description:
      "List the user's monthly budgets (category, limit, currency). Call this " +
      "to answer questions about budget limits or remaining budget.",
    parameters: z.object({}),
    handler: async () => {
      const { budgets } = useFinanceStore.getState();
      return {
        budgets: budgets.map((b) => ({
          id: b.id,
          category: b.category,
          period: b.period,
          limit: b.limit,
          currency: b.currency,
        })),
      };
    },
    render: (_props: ReadRenderProps) => {
      const { budgets, categories } = useFinanceStore.getState();
      // budgetSpent() returns base-currency totals; for the in-chat card we
      // just want the running totals keyed by category — fine for the demo
      // since most budgets are in the base currency.
      const spentByCategory: Record<string, number> = {};
      for (const b of budgets) {
        spentByCategory[b.category] = budgetSpent(b.category);
      }
      const iconByCategory: Record<string, string> = Object.fromEntries(
        categories.map((c) => [c.name, c.icon]),
      );
      return (
        <BudgetsResultCard
          budgets={budgets}
          spentByCategory={spentByCategory}
          iconByCategory={iconByCategory}
        />
      );
    },
  });

  // --- getRecentTransactions: newest-first, bounded -------------------------
  useFrontendTool({
    name: TOOLS.getRecentTransactions,
    description:
      "List the most recent transactions, newest first. Use the `limit` " +
      "argument to control how many to return (default 10). Call this to " +
      "answer questions about recent spending or activity.",
    parameters: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("How many transactions to return (default 10, max 50)."),
    }),
    handler: async ({ limit }) => {
      const n = typeof limit === "number" ? limit : 10;
      const txns = recentTransactions(n);
      return {
        count: txns.length,
        transactions: txns.map((t) => ({
          id: t.id,
          accountId: t.accountId,
          kind: t.kind,
          amount: t.amount,
          currency: t.currency,
          category: t.category,
          merchant: t.merchant,
          note: t.note,
          date: t.date,
          source: t.source,
        })),
      };
    },
    render: (props: ReadRenderProps) => {
      const n = typeof props.args?.limit === "number" ? props.args.limit : 10;
      const txns: Transaction[] = recentTransactions(n);
      const { categories, accounts } = useFinanceStore.getState();
      const iconByCategory: Record<string, string> = Object.fromEntries(
        categories.map((c) => [c.name, c.icon]),
      );
      const nameByAccountId: Record<string, string> = Object.fromEntries(
        accounts.map((a) => [a.id, a.name]),
      );
      return (
        <TransactionsResultCard
          transactions={txns}
          iconByCategory={iconByCategory}
          nameByAccountId={nameByAccountId}
        />
      );
    },
  });

  // --- getTopExpenses: biggest expenses first, bounded ---------------------
  useFrontendTool({
    name: TOOLS.getTopExpenses,
    description:
      "List the biggest expenses, largest amount first, compared in the " +
      "user's base currency (income is excluded). Use the `limit` argument " +
      "to control how many to return (default 3). Call this when the user " +
      "asks about their biggest, largest, or top expenses.",
    parameters: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("How many expenses to return (default 3, max 20)."),
    }),
    handler: async ({ limit }) => {
      const n = typeof limit === "number" ? limit : 3;
      const txns = topExpenses(n);
      return {
        count: txns.length,
        expenses: txns.map((t) => ({
          id: t.id,
          accountId: t.accountId,
          amount: t.amount,
          currency: t.currency,
          category: t.category,
          merchant: t.merchant,
          note: t.note,
          date: t.date,
        })),
      };
    },
    render: (props: ReadRenderProps) => {
      const n = typeof props.args?.limit === "number" ? props.args.limit : 3;
      const txns: Transaction[] = topExpenses(n);
      const { categories } = useFinanceStore.getState();
      const iconByCategory: Record<string, string> = Object.fromEntries(
        categories.map((c) => [c.name, c.icon]),
      );
      return (
        <TopExpensesResultCard
          expenses={txns}
          iconByCategory={iconByCategory}
        />
      );
    },
  });

  // --- getSpendByCategory: aggregated, base-currency, drives the donut ------
  useFrontendTool({
    name: TOOLS.getSpendByCategory,
    description:
      "Aggregate this calendar month's expenses by category, summed in the " +
      "user's base currency. Call this when the user asks where their money " +
      "went, how much they spent on X, or wants a breakdown / chart.",
    parameters: z.object({
      range: z
        .literal("thisMonth")
        .optional()
        .describe('Reserved for future ranges; only "thisMonth" today.'),
    }),
    handler: async () => {
      const slices = spendByCategoryThisMonth();
      const { baseCurrency } = useFinanceStore.getState();
      const total = slices.reduce((s, x) => s + x.total, 0);
      return {
        range: "thisMonth",
        baseCurrency,
        total,
        slices: slices.map((s) => ({
          category: s.category,
          icon: s.icon,
          total: s.total,
          pct: total > 0 ? s.total / total : 0,
        })),
      };
    },
    render: (_props: ReadRenderProps) => {
      const slices = spendByCategoryThisMonth();
      const baseCurrency: CurrencyCode =
        useFinanceStore.getState().baseCurrency;
      return (
        <SpendDonut
          slices={slices}
          currency={baseCurrency}
          title="Spend by category · this month"
        />
      );
    },
  });

  return null;
}
