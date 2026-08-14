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

/** A stat tile's whole text, found by its label — value first, label second. */
const tile = (label: string): string | undefined =>
  screen.getByText(label).parentElement?.textContent;

describe("ExpenseHarnessReport", () => {
  it("shows the run's scale, including how long it took", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    // Asserted as value-with-its-LABEL rather than bare presence: a count
    // rendered under the wrong label is the bug a presence-only assertion
    // cannot see, and the counts here ("14", "5") are exactly the kind of
    // string that would also pass while sitting in the wrong tile.
    expect(tile("rows read")).toBe("14rows read");
    expect(tile("merchants researched")).toBe("5merchants researched");
    // Elapsed is minutes+seconds, not raw seconds — 214s must read "3m 34s".
    expect(tile("run time")).toBe("3m 34srun time");
    // Positive currency: a summary mirrors the CSV, so nothing here is negative
    // even though the ledger stores a filed charge that way.
    expect(tile("reimbursable")).toBe("$2,377.15reimbursable");
  });

  it("renders each verdict with its reason and researched merchant kind", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    // The merchant node carries its researched kind as a child chip, so this one
    // assertion pins the pairing: name + what the web search established.
    expect(screen.getByText("Hotel Verrano").textContent).toBe(
      "Hotel Verranohotel",
    );
    // Exact "day spa", not /day spa/: this verdict's REASON also says "A day spa
    // — …", so the loose form matches two nodes and `getByText` throws. The
    // exact form pins the merchantKind chip, which is the researched kind.
    expect(screen.getByText("day spa").textContent).toBe("day spa");
    expect(screen.getByText(/Lodging on the first night/).textContent).toBe(
      "Lodging on the first night of the Austin offsite.",
    );
  });

  it("marks which rows were actually filed", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    // The filed verdict says "Filed"; the unfiled one still shows its decision.
    // Asserting both is what proves the marker discriminates rather than being
    // printed on every row.
    expect(screen.getByText("Filed").textContent).toBe("Filed");
    expect(screen.getByText("personal").textContent).toBe("personal");
  });
});
