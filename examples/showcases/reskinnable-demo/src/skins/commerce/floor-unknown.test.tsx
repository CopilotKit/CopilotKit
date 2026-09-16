import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { RendererProps } from "@copilotkit/a2ui-renderer";
import type {
  CommerceStoreState,
  MarginFloor,
  Operator,
  Product,
  Promotion,
} from "./data/types";

/**
 * THE CLASS: a surface publishing a floor verdict it never checked.
 *
 * A category can have NO margin floor on file — reachable, not theoretical (see
 * `derive.FloorStatus`'s header: an unvalidated `/ledger` cast, a provider that
 * mounts children on a FAILED first fetch with `floors: []`, `useReportData()`
 * outside its provider, an empty sandbox snapshot). In that state "is this
 * markdown below the floor?" has no answer, and `false` is the worst one
 * available: it is indistinguishable from "checked, and it is fine" on the exact
 * question the margin ladder and the beat-6 gate are ABOUT.
 *
 * Every case below runs a ledger whose SECOND category has no floor, and pins the
 * three obligations apart, because they are three different lies:
 *
 *  - ON SCREEN — an unknown floor must be visibly unknown. Not green, not red,
 *    and not a bare figure either (a real margin printed in neutral ink with no
 *    caveat reads as "checked, fine").
 *  - IN AN AGENT READABLE / SANDBOX DTO — `null`, never `false`, and never a
 *    silently truncated list. A dropped row is worse than a declared unknown,
 *    because the model cannot tell the difference.
 *  - IN A COUNT — `null` or an explicit "not checked" companion, never a green
 *    `0` that means "we did not look".
 */

const FLOORS: MarginFloor[] = [
  { category: "Knitwear", floor: 0.45, target: 0.52 },
  // NOTE: no `Home` floor. `Home` is a real `Category`, so nothing upstream
  // refuses the product below — it is simply unmeasurable.
];

/** Knitwear, floored: 40% off $100/$37 trades at 38.3% against a 45% floor. */
const CHECKED: Product = {
  id: "prd-cedar",
  sku: "BW-CDR-HDY",
  name: "Cedar Hoodie",
  category: "Knitwear",
  listPrice: 100,
  unitCost: 37,
  inventory: 120,
  trailing30Units: 40,
  status: "live",
  vendor: "Northline Mills",
};

/** Knitwear, floored, and genuinely under it at LIST price: 40% vs a 45% floor. */
const BELOW_AT_LIST: Product = {
  id: "prd-lark",
  sku: "BW-LRK-CDG",
  name: "Lark Cardigan",
  category: "Knitwear",
  listPrice: 100,
  unitCost: 60,
  inventory: 40,
  trailing30Units: 12,
  status: "live",
  vendor: "Northline Mills",
};

/** Home, UNfloored: a real 50% margin measured against nothing at all. */
const UNCHECKED: Product = {
  id: "prd-ash-vase",
  sku: "BW-ASH-VSE",
  name: "Ash Stoneware Vase",
  category: "Home",
  listPrice: 100,
  unitCost: 50,
  inventory: 80,
  trailing30Units: 20,
  status: "live",
  vendor: "Kiln & Field",
};

function promotion(overrides: Partial<Promotion>): Promotion {
  return {
    id: "promo-cedar",
    name: "Cedar Hoodie autumn markdown",
    productId: CHECKED.id,
    discountPercent: 40,
    startsAt: new Date(2026, 8, 1).toISOString(),
    endsAt: new Date(2026, 8, 22).toISOString(),
    submittedBy: "Theo Vance",
    submittedAt: new Date(2026, 7, 28).toISOString(),
    status: "pending",
    marginWaiverId: null,
    ...overrides,
  };
}

const BELOW = promotion({});
/** 30% off $100/$50 trades at 28.6% — against a floor nobody wrote down. */
const UNKNOWN = promotion({
  id: "promo-vase",
  name: "Ash Vase clearance",
  productId: UNCHECKED.id,
  discountPercent: 30,
});

const OPERATOR: Operator = {
  id: "op-nadia",
  name: "Nadia Okonjo",
  role: "merch-lead",
  team: "Merchandising",
};

function ledger(overrides: Partial<CommerceStoreState> = {}) {
  return {
    products: [CHECKED, BELOW_AT_LIST, UNCHECKED],
    floors: FLOORS,
    orders: [],
    notifications: [],
    returns: [],
    promotions: [BELOW, UNKNOWN],
    waivers: [],
    plans: [],
    operators: [OPERATOR],
    ...overrides,
  } satisfies CommerceStoreState;
}

const state: { data: CommerceStoreState } = { data: ledger() };

/** Every readable registered during a render, newest last. */
const readables: { description: string; value: string }[] = [];

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: (entry: { description: string; value: string }) => {
    readables.push(entry);
  },
}));

vi.mock("./data/ledger-context", () => ({
  useCommerceLedger: () => ({
    data: state.data,
    refresh: async () => true,
    operator: OPERATOR,
    setOperatorId: () => {},
  }),
}));

// Only `useRecording` is stubbed; the rest of the shell teach module is passed
// through, so a component that renders `RecordingProvider` / `RecordingVignette`
// / `RecordingFeed` anywhere in this graph still gets the real one.
vi.mock("@/shell/teach", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shell/teach")>()),
  useRecording: () => ({
    isRecording: false,
    steps: [],
    beginRecording: () => {},
    endRecording: () => {},
    logStep: () => {},
    getDemonstratedCode: () => null,
  }),
}));

const { PromotionsPage } = await import("./pages/promotions");
const { CatalogPage } = await import("./pages/catalog");
const { renderers } = await import("./catalog/renderers");
const { ReportDataProvider } = await import("./report-data");
const { sandboxFunctions, setSandboxSnapshot } =
  await import("./sandbox-functions");

beforeEach(() => {
  state.data = ledger();
  readables.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The one readable the page under test registered, parsed. */
const readable = (): Record<string, unknown> => {
  expect(readables).toHaveLength(1);
  return JSON.parse(readables[0].value) as Record<string, unknown>;
};

const rowFor = (parsed: Record<string, unknown>, name: string) => {
  const rows = parsed.rows as Record<string, unknown>[];
  const row = rows.find((r) => r.name === name || r.sku === name);
  if (!row) throw new Error(`No readable row for ${name}`);
  return row;
};

/** The tile with this label, as rendered by `primitives.Metric`. */
const metric = (label: string) => {
  const node = screen.getByText(label).parentElement;
  if (!node) throw new Error(`No metric tile labelled ${label}`);
  return node;
};

// ── the agent readables ─────────────────────────────────────────────────────

describe("the Promotions readable never publishes an unchecked `false`", () => {
  it("reports `belowFloor: null` for a markdown with no floor on file", () => {
    render(<PromotionsPage />);
    const parsed = readable();

    // The checked case is unaffected — this is the assertion that proves the
    // null below is about the MISSING floor and not about a broken derivation.
    expect(rowFor(parsed, BELOW.name).belowFloor).toBe(true);

    const unchecked = rowFor(parsed, UNKNOWN.name);
    expect(unchecked.floor).toBeNull();
    expect(unchecked.belowFloor).toBeNull();
    expect(unchecked.belowFloor).not.toBe(false);
  });

  it("publishes no green zero for the pending below-floor count", () => {
    // One pending markdown IS below its floor and one cannot be checked, so
    // there is no defensible total: `null` plus the companion count.
    state.data = ledger({ promotions: [UNKNOWN] });
    render(<PromotionsPage />);
    const parsed = readable();
    const book = parsed.book as Record<string, unknown>;

    expect(book.pendingBelowFloor).toBeNull();
    expect(book.pendingBelowFloor).not.toBe(0);
    expect(book.pendingWithNoFloorOnFile).toBe(1);
  });

  it("keeps whole-book figures out of the 'currently viewing' shape", () => {
    render(<PromotionsPage />);
    const parsed = readable();

    // The status filter does not narrow these, so they may not sit flat beside
    // `filters` / `visibleCount` — the defect `orders.tsx` documents as removed.
    expect(parsed.pendingTotal).toBeUndefined();
    expect(parsed.pendingBelowFloor).toBeUndefined();
    expect(parsed.book).toBeTruthy();
    expect(readables[0].description).toMatch(/book/i);
  });
});

describe("the Catalog readable scopes its book-wide floor figures", () => {
  it("nests the whole-range count, caveat and median under `book`", () => {
    render(<CatalogPage />);
    const parsed = readable();

    expect(parsed.belowFloorCount).toBeUndefined();
    expect(parsed.skusWithNoFloorOnFile).toBeUndefined();
    expect(parsed.medianMargin).toBeUndefined();

    const book = parsed.book as Record<string, unknown>;
    expect(book.belowFloorCount).toBeNull();
    expect(book.skusWithNoFloorOnFile).toBe(1);
    expect(book.medianMargin).toBeTruthy();
    expect(readables[0].description).toMatch(/book/i);
  });

  it("still reports each row's own status, `null` for the unchecked one", () => {
    render(<CatalogPage />);
    const parsed = readable();
    expect(rowFor(parsed, CHECKED.sku).belowFloor).toBe(false);
    expect(rowFor(parsed, UNCHECKED.sku).belowFloor).toBeNull();
  });
});

// ── the screen ──────────────────────────────────────────────────────────────

describe("the Promotions page shows an unchecked markdown as unchecked", () => {
  it("does not paint its margin as a healthy one", () => {
    state.data = ledger({ promotions: [UNKNOWN] });
    const { container } = render(<PromotionsPage />);

    // 28.6% is a REAL figure and stays on screen — what must not happen is it
    // being coloured as if it had cleared something.
    const margin = screen.getByText("28.6%");
    expect(margin.className).not.toContain("text-positive");
    expect(margin.className).not.toContain("text-negative");
    // ...and the card says why, rather than leaving a bare percentage that reads
    // as "checked, fine".
    expect(container.textContent).toMatch(/no (margin )?floor on file/i);
  });

  it("shows an em dash, not a green 0, on the 'Break the floor' tile", () => {
    state.data = ledger({ promotions: [UNKNOWN] });
    render(<PromotionsPage />);

    const tile = metric("Break the floor");
    expect(tile.textContent).not.toMatch(/\b0\b/);
    expect(tile.textContent).toContain("—");
    expect(tile.textContent).toMatch(/not checked|no category margin floor/i);
    expect(tile.querySelector(".text-positive")).toBeNull();
  });

  it("still flags the checked violation in red", () => {
    state.data = ledger({ promotions: [BELOW] });
    render(<PromotionsPage />);

    expect(screen.getByText("38.3%").className).toContain("text-negative");
    expect(metric("Break the floor").textContent).toContain("1");
  });
});

const TradingList = renderers.TradingList as (
  props: RendererProps<{ kind: string }>,
) => React.ReactElement;

describe("the a2ui pending-markdowns list agrees with its own comment", () => {
  const renderList = (promotions: Promotion[]) =>
    render(
      <ReportDataProvider
        value={{
          products: [CHECKED, UNCHECKED],
          floors: FLOORS,
          orders: [],
          promotions,
        }}
      >
        <TradingList
          props={{ kind: "pendingMarkdowns" }}
          // The RendererProps render-callback, not React children.
          // eslint-disable-next-line react/no-children-prop
          children={() => null as unknown as React.ReactNode}
        />
      </ReportDataProvider>,
    );

  it("says the floor is missing instead of printing a bare dash", () => {
    const { container } = renderList([UNKNOWN]);

    // The margin is a checked fact and stays. The FLOOR is what is missing, and
    // an em dash alone reads as "nothing to report" rather than "not checked".
    expect(screen.getByText("28.6%")).toBeTruthy();
    expect(container.textContent).toMatch(/no floor on file/i);
    expect(container.textContent).not.toMatch(/floor\s+—/);
  });

  it("leaves the checked violation red and floored", () => {
    const { container } = renderList([BELOW]);
    expect(screen.getByText("38.3%").className).toContain("text-negative");
    expect(container.textContent).toContain("floor 45.0%");
  });
});

// ── the sandbox DTO ─────────────────────────────────────────────────────────

type SandboxProduct = {
  sku: string;
  belowFloor: boolean | null;
  floorRatio: number | null;
};

const call = async (name: string, args: unknown): Promise<unknown> => {
  const found = sandboxFunctions.find((f) => f.name === name);
  if (!found) throw new Error(`No sandbox function named "${name}"`);
  return found.handler(args);
};

describe("the sandbox never hands generated UI a truncated floor list", () => {
  beforeEach(() => {
    setSandboxSnapshot(ledger());
  });

  it("keeps the unchecked SKU in the filtered list, flagged null", async () => {
    const rows = (await call("getProducts", {
      notClearingFloorOnly: true,
    })) as SandboxProduct[];

    // THE DEFECT: filtering on `=== "below"` DROPPED the unmeasurable SKU, so a
    // generated panel drew a complete-looking list that had silently lost a row.
    expect(rows.map((r) => r.sku).sort()).toEqual(
      [BELOW_AT_LIST.sku, UNCHECKED.sku].sort(),
    );
    expect(rows.find((r) => r.sku === BELOW_AT_LIST.sku)?.belowFloor).toBe(
      true,
    );
    expect(rows.find((r) => r.sku === UNCHECKED.sku)?.belowFloor).toBeNull();
  });

  it("tells the model an unchecked SKU is not one of the violations", () => {
    // The description is the ONLY view the model gets of this shape — no sample
    // result is ever registered — so "null means unchecked, do not count it" has
    // to be said there or it is said nowhere.
    const fn = sandboxFunctions.find((f) => f.name === "getProducts");
    expect(fn?.description).toMatch(/no floor on file/i);
    expect(fn?.description).toMatch(/not checked|unchecked/i);
    expect(fn?.description).toMatch(/never count it|not.*count/i);
  });

  it("refuses the RENAMED filter's old key instead of silently widening", async () => {
    // Zod strips an unrecognized key, so without `.strict()` this would come back
    // as the whole range — a superset drawn under a "below floor" title.
    await expect(call("getProducts", { belowFloorOnly: true })).rejects.toThrow(
      /rejected its arguments/i,
    );
  });

  it("leaves an unfiltered read complete either way", async () => {
    const rows = (await call("getProducts", {})) as SandboxProduct[];
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.sku === CHECKED.sku)?.belowFloor).toBe(false);
    expect(rows.find((r) => r.sku === UNCHECKED.sku)?.belowFloor).toBeNull();
  });
});
