import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseHarnessReport } from "./expense-harness-report";
import type { HarnessSummary } from "@/skins/banking/harness/types";

/**
 * No `@testing-library/jest-dom` in this app, so assertions are plain DOM —
 * `getByText` already throws when it matches nothing or matches more than once,
 * and `toBeTruthy()` only records that we consumed the result.
 */

const SUMMARY: HarnessSummary = {
  rowsRead: 14,
  merchantsSearched: 5,
  totalExpensable: 2377.15,
  totalPersonal: 204.44,
  elapsedSeconds: 214,
  verdicts: [
    {
      merchant: "Hotel Verrano",
      date: "2026-07-14",
      amount: 318.55,
      decision: "expensable",
      reason: "Lodging on the first night of the Austin offsite.",
      merchantKind: "hotel",
      filedTransactionId: "txn_1",
    },
    {
      merchant: "Sundry Wellness Co",
      date: "2026-07-16",
      amount: 180,
      decision: "personal",
      reason: "A day spa — personal consumption, not a business expense.",
      merchantKind: "day spa",
    },
  ],
};

describe("ExpenseHarnessReport", () => {
  it("shows the run's scale, including how long it took", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    expect(screen.getByText("14")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText(/3m 34s/)).toBeTruthy();
  });

  it("renders each verdict with its reason and researched merchant kind", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    expect(screen.getByText("Hotel Verrano")).toBeTruthy();
    // Exact, not /day spa/: this verdict's REASON also says "A day spa — …", so
    // the loose form matches two nodes and `getByText` throws. The exact form
    // pins the merchantKind chip, which is what the researched kind is.
    expect(screen.getByText("day spa")).toBeTruthy();
    expect(screen.getByText(/Lodging on the first night/)).toBeTruthy();
  });

  it("marks which rows were actually filed", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    expect(screen.getByText(/Filed/)).toBeTruthy();
  });
});
