import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import {
  ExpenseRole,
  type ExpensePolicy,
  type Transaction,
} from "@/app/api/v1/data";
import { formatCurrency } from "@/lib/utils";
import { ReportDataProvider, type ReportData } from "../report-data";
import { renderers } from "./renderers";

// Typed fixture builders keep the test honest against the real domain shapes
// (no `as never`): the renderer derives "over limit" from policies, so the
// fixture must genuinely exercise that derivation.
function makeTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: "t",
    title: "Charge",
    amount: -100,
    date: "2026-01-01",
    policyId: "p1",
    cardId: "c1",
    status: "approved",
    ...overrides,
  };
}

function makePolicy(overrides: Partial<ExpensePolicy>): ExpensePolicy {
  return {
    id: "p1",
    type: ExpenseRole.Engineering,
    limit: 1000,
    spent: 0,
    ...overrides,
  };
}

// Policy p1: limit 1000, spent 900.
// - t1 approved  (-300)                     -> counts toward totalSpend
// - t2 pending   (-200) 900+200=1100 > 1000 -> OVER LIMIT (no exception)
// - t3 pending   (-50)  900+50 =950  <=1000 -> pending, not over limit
// - t4 pending   (-500) 900+500=1400>1000   -> over threshold BUT has an
//                                              active exception -> NOT over limit
const data: ReportData = {
  policies: [makePolicy({ id: "p1", limit: 1000, spent: 900 })],
  transactions: [
    makeTransaction({ id: "t1", status: "approved", amount: -300 }),
    makeTransaction({ id: "t2", status: "pending", amount: -200 }),
    makeTransaction({ id: "t3", status: "pending", amount: -50 }),
    makeTransaction({
      id: "t4",
      status: "pending",
      amount: -500,
      activeExceptionId: "ex1",
    }),
  ],
};

// The catalog renderers are typed as A2UI RendererProps components; call them
// directly as functions at the test boundary with the props they consume.
const StatCard = renderers.StatCard as (
  props: RendererProps<{ metric: string; label: string }>,
) => React.ReactElement;

function renderStatCard(metric: string, label: string) {
  return render(
    <ReportDataProvider value={data}>
      <StatCard
        props={{ metric, label }}
        // `children` here is the RendererProps render-callback (a function),
        // not React children — passing it as a prop is intentional.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </ReportDataProvider>,
  );
}

describe("banking catalog StatCard renderer", () => {
  it("overLimitCount derives over-limit pending charges from policies", () => {
    // Only t2 pushes its policy over the limit with no clearing exception.
    renderStatCard("overLimitCount", "Over limit");
    expect(screen.getByText("Over limit")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
  });

  it("pendingCount counts all pending transactions", () => {
    // t2, t3, t4 are pending.
    renderStatCard("pendingCount", "Pending");
    expect(screen.getByText("Pending")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
  });

  it("totalSpend sums approved charges and formats as currency", () => {
    // Only t1 (approved, -300) contributes.
    renderStatCard("totalSpend", "Total spend");
    expect(screen.getByText(formatCurrency(300))).toBeDefined();
  });
});

const Transactions = renderers.Transactions as (
  props: RendererProps<{ status?: string }>,
) => React.ReactElement;

function renderTransactions(status: string) {
  return render(
    <ReportDataProvider value={data}>
      <Transactions
        props={{ status }}
        // `children` is the RendererProps render-callback, not React children.
        // eslint-disable-next-line react/no-children-prop
        children={() => null as unknown as React.ReactNode}
      />
    </ReportDataProvider>,
  );
}

describe("banking catalog Transactions renderer", () => {
  it("shows an empty state for a status with no matching rows", () => {
    // The fixture has no denied transactions.
    renderTransactions("denied");
    expect(screen.getByText("No denied transactions.")).toBeDefined();
  });

  it("renders the table (not the empty state) when rows match the status", () => {
    // t1 is approved, so the table renders instead of the empty state.
    renderTransactions("approved");
    expect(screen.queryByText("No approved transactions.")).toBeNull();
  });
});
