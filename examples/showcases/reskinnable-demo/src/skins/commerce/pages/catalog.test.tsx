import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type {
  CommerceStoreState,
  RestockPlan,
} from "@/skins/commerce/data/types";

/**
 * A filed restock plan's highlights, lines and schedule come from the MODEL
 * reading an uploaded price sheet, and nothing between the tool call and this
 * page de-duplicates them. So the Plans panel must render a plan whose rows
 * repeat: every row present, and no duplicate React keys (which React reports on
 * console.error, and which silently corrupts reconciliation when ignored).
 */

const plan: RestockPlan = {
  id: "pln-dup",
  vendor: "Kestrel Mills",
  season: "Autumn knitwear",
  summary: "Two pack sizes of the same SKU, quoted twice on the sheet.",
  // The same fact twice — a model summarising a sheet section by section.
  highlights: ["Lead time is six weeks", "Lead time is six weeks"],
  // The same SKU twice — two pack sizes, or a row repeated on the sheet.
  lines: [
    { sku: "BW-CDR-HDY", name: "Cedar Hoodie", landedCost: 47, units: 600 },
    { sku: "BW-CDR-HDY", name: "Cedar Hoodie", landedCost: 44, units: 600 },
    {
      sku: "BW-MSS-SCF",
      name: "Moss Merino Scarf",
      landedCost: 33,
      units: 800,
    },
  ],
  // The same step twice — two shipments in one week.
  schedule: [
    { week: "Week 1", item: "PO issued" },
    { week: "Week 1", item: "PO issued" },
  ],
  filedAt: new Date().toISOString(),
  filedBy: "Nadia Okonjo",
};

const ledger: CommerceStoreState = {
  products: [],
  floors: [],
  orders: [],
  notifications: [],
  returns: [],
  promotions: [],
  waivers: [],
  plans: [plan],
  operators: [],
};

// The page's only two outbound couplings. Mocking them keeps this a render test
// of the list, not of the provider stack or the runtime.
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: () => undefined,
}));
vi.mock("@/skins/commerce/data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: ledger,
    refresh: async () => {},
    operator: {
      id: "op-nadia",
      name: "Nadia Okonjo",
      role: "merch-lead",
      team: "Merchandising",
    },
    setOperatorId: () => {},
  }),
}));

// Imported after the mocks are registered (vi.mock is hoisted, but keeping the
// import here documents the dependency order for a reader).
const { CatalogPage } = await import("@/skins/commerce/pages/catalog");

let errors: unknown[][] = [];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Direct `<li>` children. Read off `children` rather than with a `:scope > li`
 * selector: jsdom's selector engine mangles `:scope` when the host element
 * carries a class with a dot in it (`mt-2.5`), which these lists do.
 */
const rowsOf = (list: Element) =>
  Array.from(list.children).filter((el) => el.tagName === "LI");

const duplicateKeyWarnings = () =>
  errors.filter((args) =>
    args.some(
      (arg) => typeof arg === "string" && /same key|duplicate key/i.test(arg),
    ),
  );

describe("CatalogPage — Restock plans with repeated rows", () => {
  it("renders every highlight, line and schedule step even when they repeat", () => {
    const { container } = render(<CatalogPage />);

    // Products are empty, so the only <ul>s on the page are the plan's
    // highlights then its lines; the schedule is the only <ol>.
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(rowsOf(lists[0])).toHaveLength(plan.highlights.length);
    expect(rowsOf(lists[1])).toHaveLength(plan.lines.length);
    const schedule = container.querySelector("ol");
    expect(schedule).not.toBeNull();
    expect(rowsOf(schedule as HTMLElement)).toHaveLength(plan.schedule.length);

    // Both quoted costs for the repeated SKU survive: a collapsed or reused row
    // would drop one of them.
    const text = container.textContent ?? "";
    expect(text).toContain("$47");
    expect(text).toContain("$44");
  });

  it("hands React no duplicate keys", () => {
    render(<CatalogPage />);
    expect(duplicateKeyWarnings()).toEqual([]);
  });
});
