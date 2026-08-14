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
    /**
     * The row that makes the filed/unfiled assertions mean something: EXPENSABLE
     * yet carrying no `filedTransactionId`, which is what the harness produces
     * when a filing call does not come back 201. Without it every fixture row
     * varies `decision` and filed-ness together, so a component written
     * `decision === "expensable" ? "Filed" : decision` — the bug that claims a
     * filing nobody made — passes the whole file.
     */
    {
      merchant: "Skyline Airport Parking",
      date: "2026-07-16",
      amount: 64,
      decision: "expensable",
      reason:
        "Offsite airport parking; the filing call returned 500, so nothing was posted.",
      merchantKind: "airport parking",
    },
  ],
};

/**
 * One stat tile, addressed by the `data-stat` hook rather than by walking up from
 * its label. Scoping to the tile is what keeps "the count landed in the WRONG
 * tile" a failure, while `within` + `toContain` leave the tile's internal element
 * depth and its value/label order as the cosmetic details they are.
 */
const tile = (label: string): HTMLElement => {
  const element = document.querySelector(`[data-stat="${label}"]`);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`no stat tile labelled "${label}"`);
  }
  return element;
};

describe("ExpenseHarnessReport", () => {
  it("shows the run's scale, including how long it took", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);
    // Each value is asserted INSIDE its own tile: "14" anywhere on the card would
    // pass while sitting under "merchants researched", which is the failure a
    // presence-only assertion cannot see.
    expect(tile("rows read").textContent).toContain("14");
    expect(tile("rows read").textContent).toContain("rows read");
    expect(tile("merchants researched").textContent).toContain("5");
    // Elapsed is minutes+seconds, not raw seconds — 214s must read "3m 34s".
    expect(tile("run time").textContent).toContain("3m 34s");
    // Positive currency: a summary mirrors the CSV, so nothing here is negative
    // even though the ledger stores a filed charge that way.
    expect(tile("reimbursable").textContent).toContain("$2,377.15");
    expect(tile("reimbursable").textContent).not.toContain("-$");
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

  it("never claims a filing for an expensable row that was not filed", () => {
    render(<ExpenseHarnessReport summary={SUMMARY} />);

    // Reads its DECISION, not "Filed" — keyed off `filedTransactionId`, so
    // `decision === "expensable" ? "Filed" : decision` fails here.
    const unfiled = screen.getByText("expensable");
    expect(unfiled.textContent).toBe("expensable");
    expect(screen.getByText("not filed").textContent).toBe("not filed");

    // …and it does not read as a success. The distinction a viewer actually
    // relies on is the tint, so assert the tint and not merely the wording: an
    // unfiled charge in the same green as a filed one is the row a presenter
    // would skip past.
    const filed = screen.getByText("Filed");
    expect(filed.className).toContain("text-positive");
    expect(unfiled.className).toContain("text-negative");
    expect(unfiled.className).not.toContain("text-positive");
    expect(unfiled.className).not.toBe(filed.className);
  });
});
