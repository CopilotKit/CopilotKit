import { beforeEach, describe, expect, it } from "vitest";
import {
  formatMargin,
  openReturns,
  ordersOnException,
  productMargin,
  valueAtRisk,
} from "./data/derive";
import * as store from "./data/store";
import { sandboxFunctions, setSandboxSnapshot } from "./sandbox-functions";
import { CATEGORIES } from "./data/types";
import type { CommerceStoreState, Order } from "./data/types";

/**
 * The OGUI sandbox functions, tested for ONE thing: that a generated panel
 * cannot disagree with the app card sitting next to it — or with the ledger.
 *
 * This is not a hypothetical. Generated UI renders full-region on the shared
 * canvas, off the same ledger the pages read, so a set predicate hand-copied
 * into this file does not fail loudly — it puts a second, larger number on
 * screen beside the first one. Both defects below shipped that way: the
 * `exceptionsOnly` filter counted cancelled orders as queue work, and
 * `openReturns` counted declined returns as open.
 *
 * So every assertion here compares the sandbox's answer against the SHARED
 * derivation the pages and the a2ui StatCards use (`ordersOnException`,
 * `valueAtRisk`, `openReturns` in `data/derive.ts`) — a re-introduced local
 * copy fails here rather than on stage.
 *
 * The later blocks cover the two ways a boundary can be wrong while still
 * RENDERING: an argument the schema does not really constrain (a near-miss
 * category filtering to nothing, which draws an empty view that looks like an
 * answer) and a figure whose unit is not stated (a bare `0.418` that renders as
 * "0.42%" or "42%" with equal confidence).
 */

beforeEach(() => {
  store.reset();
  setSandboxSnapshot(store.snapshot());
});

const fn = (name: string) => {
  const found = sandboxFunctions.find((f) => f.name === name);
  if (!found) throw new Error(`No sandbox function named "${name}"`);
  return found;
};

type OrderRow = { id: string; status: string; total: number };
type TradingKpis = {
  ordersOnException: number;
  valueAtRisk: number;
  openReturns: number;
};
type ProductRow = {
  id: string;
  category: string;
  marginRatio: number;
  marginLabel: string;
  floorRatio: number | null;
  floorLabel: string | null;
};
type FloorRow = {
  category: string;
  floorRatio: number;
  floorLabel: string;
  targetRatio: number;
  targetLabel: string;
};
type PromoRow = {
  id: string;
  marginRatio: number | null;
  marginLabel: string | null;
  floorRatio: number | null;
  floorLabel: string | null;
};

const getOrders = async (args: {
  status?: string;
  exceptionsOnly?: boolean;
}): Promise<OrderRow[]> => (await fn("getOrders").handler(args)) as OrderRow[];

const getTradingKpis = async (): Promise<TradingKpis> =>
  (await fn("getTradingKpis").handler({})) as TradingKpis;

const getProducts = async (args: {
  category?: string;
  notClearingFloorOnly?: boolean;
}): Promise<ProductRow[]> =>
  (await fn("getProducts").handler(args)) as ProductRow[];

const getMarginFloors = async (): Promise<FloorRow[]> =>
  (await fn("getMarginFloors").handler({})) as FloorRow[];

const getPromotions = async (args: { status?: string }): Promise<PromoRow[]> =>
  (await fn("getPromotions").handler(args)) as PromoRow[];

/**
 * A ledger holding a CANCELLED order that still carries the exception it was
 * cancelled with — the row the two predicates disagreed about.
 *
 * Reachable in a live demo: `PATCH /api/commerce/v1/orders/[id]` accepts
 * `status: "cancelled"` and `store.setOrderStatus` writes it without touching
 * `exception`. Built by hand here rather than through that mutation so the
 * fixture keeps testing the sandbox even if the store later starts clearing the
 * exception on a settle — whatever rows the sandbox is handed, it must read them
 * the way the app does.
 */
function ledgerWithCancelledException(): {
  ledger: CommerceStoreState;
  cancelled: Order;
} {
  const base = store.snapshot();
  const victim = base.orders.find((o) => o.exception !== "none");
  if (!victim) throw new Error("The seed carries no exception order");
  const cancelled: Order = { ...victim, status: "cancelled" };
  return {
    ledger: {
      ...base,
      orders: base.orders.map((o) => (o.id === victim.id ? cancelled : o)),
    },
    cancelled,
  };
}

describe("getOrders — exceptionsOnly", () => {
  it("drops a cancelled order, exactly as every other queue view does", async () => {
    const baseline = ordersOnException(store.orders()).length;
    expect(baseline).toBeGreaterThan(1);

    const { ledger, cancelled } = ledgerWithCancelledException();
    setSandboxSnapshot(ledger);

    const rows = await getOrders({ exceptionsOnly: true });

    // One fewer than the untouched queue — the cancelled row, and only it.
    expect(rows).toHaveLength(baseline - 1);
    expect(rows.map((r) => r.id)).not.toContain(cancelled.id);
    expect(rows.map((r) => r.id).sort()).toEqual(
      ordersOnException(ledger.orders)
        .map((o) => o.id)
        .sort(),
    );
  });

  it("cannot return a cancelled row even when the status lever asks for one", async () => {
    const { ledger, cancelled } = ledgerWithCancelledException();
    setSandboxSnapshot(ledger);

    // status=cancelled AND exceptionsOnly is a contradiction now that a
    // cancelled order is by definition not queue work. Empty is the honest
    // answer; the old predicate returned the row.
    const queue = await getOrders({
      status: "cancelled",
      exceptionsOnly: true,
    });
    expect(queue).toEqual([]);
    // Without the exception filter the row is still reachable — the fix narrowed
    // the QUEUE, it did not hide the order.
    const all = await getOrders({ status: "cancelled" });
    expect(all.map((r) => r.id)).toEqual([cancelled.id]);
  });
});

describe("getTradingKpis", () => {
  it("matches the app's own exception count and value at risk", async () => {
    const { ledger, cancelled } = ledgerWithCancelledException();
    const untouchedValue = valueAtRisk(store.orders());
    setSandboxSnapshot(ledger);

    const kpis = await getTradingKpis();

    expect(kpis.ordersOnException).toBe(
      ordersOnException(ledger.orders).length,
    );
    expect(kpis.valueAtRisk).toBe(valueAtRisk(ledger.orders));
    // The cancelled order's money is no longer at risk, and it is the only
    // difference from the untouched ledger.
    expect(kpis.valueAtRisk).toBe(untouchedValue - cancelled.total);
  });

  it("agrees with getOrders row for row, so one panel cannot contradict another", async () => {
    const { ledger } = ledgerWithCancelledException();
    setSandboxSnapshot(ledger);

    const kpis = await getTradingKpis();
    const rows = await getOrders({ exceptionsOnly: true });

    expect(rows).toHaveLength(kpis.ordersOnException);
    expect(rows.reduce((sum, r) => sum + r.total, 0)).toBe(kpis.valueAtRisk);
  });

  it("counts a declined return as closed, exactly as the Returns page does", async () => {
    const baseline = openReturns(store.returns()).length;
    expect(baseline).toBeGreaterThan(1);

    // The real path: the Returns page's decline button and the REST route both
    // land here, so a declined return is ordinary demo state, not a contrivance.
    const declined = store.decideReturn("ret-2201", "declined");
    expect(declined.status).toBe("declined");
    setSandboxSnapshot(store.snapshot());

    const kpis = await getTradingKpis();

    expect(kpis.openReturns).toBe(baseline - 1);
    expect(kpis.openReturns).toBe(openReturns(store.returns()).length);
    // Both finished states are excluded — refunded was already, declined now.
    // Spelled out as an arithmetic identity so neither half can regress alone.
    const finished = store
      .returns()
      .filter((r) => r.status === "refunded" || r.status === "declined");
    expect(finished).toHaveLength(2);
    expect(kpis.openReturns).toBe(store.returns().length - finished.length);
  });
});

describe("the schemas are enforced, not merely advertised", () => {
  /**
   * The runtime does not validate these arguments — the provider serializes
   * `parameters` into agent context as documentation and the renderer hands the
   * bare handler to the iframe. So the schema has to be applied by the file that
   * declares it, and these tests are what says it still is. An unenforced schema
   * is invisible: the handler filters on a value nothing matches and returns `[]`,
   * which the generated panel draws as an empty table.
   */
  it("refuses an off-vocabulary category rather than answering with an empty range", async () => {
    await expect(getProducts({ category: "Shoes" })).rejects.toThrow(
      /getProducts rejected its arguments/,
    );
    // The message has to carry the vocabulary, or the model cannot correct
    // itself — it is the only feedback channel a sandbox call has.
    await expect(getProducts({ category: "Shoes" })).rejects.toThrow(
      /Footwear/,
    );
    // And it must say the call read nothing, so the script does not fall back to
    // drawing an empty view.
    await expect(getProducts({ category: "Shoes" })).rejects.toThrow(
      /Nothing was read/,
    );
  });

  it("refuses a case near-miss, which is what a model actually guesses", async () => {
    await expect(getProducts({ category: "footwear" })).rejects.toThrow(
      /getProducts rejected its arguments/,
    );
  });

  it("serves every category in the vocabulary, and together they cover the range", async () => {
    const perCategory = await Promise.all(
      CATEGORIES.map((category) => getProducts({ category })),
    );

    CATEGORIES.forEach((category, index) => {
      const rows = perCategory[index]!;
      // Every declared category is a real, populated filter — a value the schema
      // offers and the ledger cannot serve is the same blank view by another route.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.category === category)).toBe(true);
    });

    // No product is unreachable, so the enum is the WHOLE vocabulary rather than
    // a subset that quietly hides part of the range.
    expect(perCategory.flat()).toHaveLength(store.products().length);
  });

  it("refuses an off-vocabulary status on the other filters too", async () => {
    await expect(getOrders({ status: "Open" })).rejects.toThrow(
      /getOrders rejected its arguments/,
    );
    await expect(getPromotions({ status: "live" })).rejects.toThrow(
      /getPromotions rejected its arguments/,
    );
    await expect(fn("getReturns").handler({ status: "open" })).rejects.toThrow(
      /getReturns rejected its arguments/,
    );
  });

  it("still accepts a no-argument call on the parameterless functions", async () => {
    // `undefined` arrives when generated UI calls `getTradingKpis()` with no
    // args; a `z.object({})` schema rejects `undefined`, so the wrapper defaults
    // it. Enforcement must not break the most common call in the file.
    await expect(fn("getTradingKpis").handler(undefined)).resolves.toBeTruthy();
    await expect(
      fn("getMarginFloors").handler(undefined),
    ).resolves.toBeTruthy();
    const products = (await fn("getProducts").handler(
      undefined,
    )) as ProductRow[];
    expect(products).toHaveLength(store.products().length);
  });
});

describe("every margin crosses the boundary with its unit", () => {
  /**
   * A margin is the one figure here that renders plausibly WRONG. `0.418` is
   * "0.42%" or "41.8%" depending on a guess the model has no way to check, and
   * `discountPercent: 40` sits in the same object to make the wrong guess look
   * reasonable. So each one goes over as a `…Ratio` fraction of 1 for geometry
   * plus a `…Label` built by the app's own `formatMargin` — which also makes the
   * generated panel read identically to the app card beside it, one decimal and
   * all.
   */
  it("getProducts pairs each ratio with the app's own label", async () => {
    const rows = await getProducts({});
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const item = store.product(row.id)!;
      expect(row.marginRatio).toBeCloseTo(productMargin(item), 10);
      expect(row.marginRatio).toBeGreaterThan(0);
      expect(row.marginRatio).toBeLessThan(1);
      // Byte-identical to what the catalog and the ladder print.
      expect(row.marginLabel).toBe(formatMargin(productMargin(item)));
      expect(row.marginLabel).toMatch(/^\d+\.\d%$/);
      expect(row.floorRatio).not.toBeNull();
      expect(row.floorLabel).toBe(formatMargin(row.floorRatio as number));
    }
  });

  it("getMarginFloors labels the floor and the target", async () => {
    const rows = await getMarginFloors();
    expect(rows).toHaveLength(store.floors().length);

    for (const row of rows) {
      const policy = store.floors().find((f) => f.category === row.category)!;
      expect(row.floorRatio).toBe(policy.floor);
      expect(row.floorLabel).toBe(formatMargin(policy.floor));
      expect(row.targetRatio).toBe(policy.target);
      expect(row.targetLabel).toBe(formatMargin(policy.target));
    }
  });

  it("getPromotions labels the markdown margin it would trade at", async () => {
    const rows = await getPromotions({ status: "all" });
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.marginLabel).toBe(
        row.marginRatio === null ? null : formatMargin(row.marginRatio),
      );
      expect(row.floorLabel).toBe(
        row.floorRatio === null ? null : formatMargin(row.floorRatio),
      );
    }
    // At least one seeded markdown trades below its floor — the beat-6 case — so
    // the labelled figures are exercised on the row the demo turns on.
    expect(rows.some((r) => r.marginRatio !== null)).toBe(true);
  });

  it("keeps a label null rather than formatting a margin it does not have", async () => {
    const base = store.snapshot();
    // A ledger whose floors never arrived (a failed `/ledger` fetch mounts the
    // provider with `floors: []`) and a markdown pointing at a product that is
    // not in the range. Both are reachable, and neither may produce a "0.0%"
    // that reads as a real floor.
    setSandboxSnapshot({
      ...base,
      floors: [],
      promotions: base.promotions.map((p, i) =>
        i === 0 ? { ...p, productId: "prd-missing" } : p,
      ),
    });

    const rows = await getPromotions({ status: "all" });
    const orphan = rows[0]!;
    expect(orphan.marginRatio).toBeNull();
    expect(orphan.marginLabel).toBeNull();
    expect(orphan.floorRatio).toBeNull();
    expect(orphan.floorLabel).toBeNull();

    const products = await getProducts({});
    expect(products.every((p) => p.floorRatio === null)).toBe(true);
    expect(products.every((p) => p.floorLabel === null)).toBe(true);
    // The unit fix must not reintroduce the false all-clear: no floor on file
    // still reports `null`, never `false`.
    expect(
      products.every(
        (p) => (p as unknown as { belowFloor: unknown }).belowFloor === null,
      ),
    ).toBe(true);
  });

  it("ships no bare `margin` or `floor` key for a view to misread", async () => {
    const rows = [
      ...(await getProducts({})),
      ...(await getPromotions({ status: "all" })),
      ...(await getMarginFloors()),
    ] as unknown as Record<string, unknown>[];

    for (const row of rows) {
      // An unlabelled ratio under a bare name is exactly what shipped. Naming the
      // unit is only half the fix; the ambiguous name has to be gone.
      expect(Object.keys(row)).not.toContain("margin");
      expect(Object.keys(row)).not.toContain("floor");
      expect(Object.keys(row)).not.toContain("target");
    }
  });

  it("documents the unit in the description, the model's only view of the shape", () => {
    // Only `name`, `description` and the JSON-schema-ified `parameters` reach the
    // agent — never a sample result. If the description does not state the unit,
    // nothing does.
    for (const name of ["getProducts", "getMarginFloors", "getPromotions"]) {
      expect(fn(name).description).toMatch(/fractions? of 1/);
      expect(fn(name).description).toMatch(/render the label/);
    }
    for (const name of [
      "getProducts",
      "getOrders",
      "getPromotions",
      "getReturns",
      "getTradingKpis",
    ]) {
      expect(fn(name).description).toMatch(/US dollars/);
    }
  });
});
