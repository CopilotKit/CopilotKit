import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  FAN_LEGIBLE_MAX,
  FAN_MAX_FRACTION,
  MarginLadder,
  fanLeft,
  fanOffsets,
  ladderCaption,
  labelTransform,
  placeLabels,
  LABEL_ROW_PX,
} from "@/skins/commerce/components/margin-ladder";
import type {
  LadderProduct,
  PlacedDot,
} from "@/skins/commerce/components/margin-ladder";
import type { MarginFloor, Product } from "@/skins/commerce/data/types";

/**
 * THE LADDER'S CAPTION MAY NOT ALL-CLEAR A RANGE IT DID NOT CHECK.
 *
 * The caption is this component's verdict, and it used to be derived from a
 * below-floor COUNT alone: zero → "Every product is trading above its category
 * floor." An empty range has a below-floor count of zero too, so an EMPTY ladder
 * printed the all-clear — zero violations found because zero products were
 * examined, which is the strongest false reassurance the component can give, and
 * the one indistinguishable from good news.
 *
 * Both empty shapes are reachable, not theoretical: `showMarginLadder` filters
 * products by a MODEL-supplied category while falling back to the full floors
 * list (so an invented or misspelt category draws every rail and no dots), and
 * `ledger-context` mounts children with `products: []` on a failed first fetch.
 */

const FLOORS: MarginFloor[] = [
  { category: "Footwear", floor: 0.4, target: 0.5 },
  { category: "Accessories", floor: 0.55, target: 0.64 },
];

const product = (over: Partial<Product> = {}): Product => ({
  id: "prd-x",
  sku: "BW-X",
  name: "Test Product",
  category: "Footwear",
  listPrice: 145,
  unitCost: 88, // 39.3% margin — under the 40% Footwear floor
  inventory: 480,
  trailing30Units: 388,
  status: "live",
  vendor: "Vela Footworks",
  ...over,
});

const belowSku = product({ id: "prd-below" });
// 60% margin against the same 40% floor.
const clearSku = product({ id: "prd-clear", listPrice: 200, unitCost: 80 });
// "Home" has no floor in FLOORS: on no rail, checked against nothing.
const homelessSku = product({ id: "prd-homeless", category: "Home" });

const ALL_CLEAR = "Every product is trading above its category floor.";

afterEach(cleanup);

describe("ladderCaption", () => {
  it("does NOT all-clear an empty range", () => {
    const caption = ladderCaption({ below: 0, clear: 0, unknown: 0 });
    expect(caption).not.toContain(ALL_CLEAR);
    expect(caption).not.toMatch(/No plotted product is below/);
    expect(caption).toMatch(/No products in this range/);
    expect(caption).toMatch(/nothing has been checked/);
  });

  it("does NOT all-clear a range where nothing could be plotted", () => {
    const caption = ladderCaption({ below: 0, clear: 0, unknown: 3 });
    expect(caption).not.toContain(ALL_CLEAR);
    // "No plotted product is below its floor" is vacuous with zero plotted.
    expect(caption).not.toMatch(/No plotted product is below/);
    expect(caption).toMatch(/Nothing is plotted/);
    expect(caption).toMatch(/all 3 products/);
    expect(caption).toMatch(/not checked/);
  });

  it("all-clears only a range that was fully checked", () => {
    expect(ladderCaption({ below: 0, clear: 4, unknown: 0 })).toBe(ALL_CLEAR);
  });

  it("caveats a clean but partially checked range", () => {
    const caption = ladderCaption({ below: 0, clear: 4, unknown: 1 });
    expect(caption).toMatch(/No plotted product is below its floor/);
    expect(caption).toMatch(/1 product has no category floor on file/);
    expect(caption).toMatch(/not on any rail/);
  });

  it("counts violations, singular and plural", () => {
    expect(ladderCaption({ below: 1, clear: 3, unknown: 0 })).toBe(
      "1 product is below their category floor — shown in red, under the floor line.",
    );
    expect(ladderCaption({ below: 2, clear: 3, unknown: 0 })).toMatch(
      /^2 products are below their category floor/,
    );
  });

  it("reports violations AND unchecked SKUs together", () => {
    const caption = ladderCaption({ below: 2, clear: 1, unknown: 2 });
    expect(caption).toMatch(/^2 products are below their category floor/);
    expect(caption).toMatch(/2 more have no floor on file and are not plotted/);
  });
});

/**
 * THE FAN MAY NOT HIDE A DOT, AND MAY NOT MOVE ONE ONTO THE NEXT RAIL.
 *
 * The ladder's entire job is letting someone count violations per category at a
 * glance, so both of the old fan's failures were wrong READINGS:
 *  - offsets came from a seven-entry px table indexed `idx % 7`, so the 8th
 *    co-located SKU was drawn exactly on top of the 1st and the reader
 *    undercounted, silently;
 *  - the table reached ±45px while a column is ~75px inside a compact chat card,
 *    and nothing in this component clips overflow, so a dot could be painted over
 *    the NEIGHBOURING category's rail.
 * Both are reachable from one prompt: `showMarginLadder` takes a category filter,
 * which puts a whole category's range on one rail.
 */
const RUN_SIZES = [2, 3, 5, 7, 8, 9, 13, 40, 200];

describe("collision fan geometry", () => {
  it("gives every dot in a run a DISTINCT offset, well past the old 7 slots", () => {
    for (const count of RUN_SIZES) {
      const offsets = fanOffsets(count);
      expect(offsets, `run of ${count}`).toHaveLength(count);
      expect(new Set(offsets).size, `run of ${count}`).toBe(count);
    }
  });

  it("never pushes a dot as far as the column's half-width", () => {
    for (const count of RUN_SIZES) {
      for (const offset of fanOffsets(count)) {
        // Fractions of the COLUMN width: 0.5 is where a dot reaches the next
        // column, and the cap leaves room for the dot's own radius too.
        expect(Math.abs(offset), `run of ${count}`).toBeLessThanOrEqual(
          FAN_MAX_FRACTION,
        );
        expect(Math.abs(offset), `run of ${count}`).toBeLessThan(0.5);
      }
    }
  });

  it("stays tight for a small run and widens only as the run grows", () => {
    const spread = (count: number) => {
      const offsets = fanOffsets(count);
      return Math.max(...offsets) - Math.min(...offsets);
    };
    expect(fanOffsets(0)).toEqual([]);
    expect(fanOffsets(1)).toEqual([0]);
    expect(spread(2)).toBeGreaterThan(0);
    expect(spread(3)).toBeGreaterThan(spread(2));
    expect(spread(9)).toBeGreaterThan(spread(3));
    // Saturated: past the cap the fan cannot widen, it can only subdivide.
    expect(spread(40)).toBeCloseTo(2 * FAN_MAX_FRACTION, 6);
  });

  it("draws a 12-SKU pile-up as 12 distinct positions on the rail", () => {
    const pile = Array.from({ length: 12 }, (_, i) =>
      product({ id: `prd-pile-${i}`, name: `Pile ${i}` }),
    );
    const { container } = render(
      <MarginLadder floors={FLOORS} products={pile} />,
    );
    const lefts = Array.from(
      container.querySelectorAll<HTMLElement>("button[aria-label]"),
    ).map((el) => el.style.left);
    expect(lefts).toHaveLength(12);
    expect(new Set(lefts).size).toBe(12);
    for (const left of lefts) {
      // jsdom folds `calc(50% - 14%)` down to `calc(36%)`, i.e. the dot's centre
      // as a share of ITS OWN column: anything outside 0–100 is on a neighbour's
      // rail, and the fan's cap keeps it well inside that.
      const pct = Number(/([\d.]+)%/.exec(left)?.[1]);
      expect(Number.isFinite(pct), left).toBe(true);
      expect(pct, left).toBeGreaterThanOrEqual(50 - FAN_MAX_FRACTION * 100);
      expect(pct, left).toBeLessThanOrEqual(50 + FAN_MAX_FRACTION * 100);
      expect(pct, left).toBeGreaterThan(0);
      expect(pct, left).toBeLessThan(100);
    }
  });

  it("states the count when a pile-up is too dense to separate by eye", () => {
    const pile = Array.from({ length: FAN_LEGIBLE_MAX + 1 }, (_, i) =>
      product({ id: `prd-pile-${i}` }),
    );
    const { container } = render(
      <MarginLadder floors={FLOORS} products={pile} />,
    );
    // Not "cap and say nothing": the reader is told how many are stacked here.
    expect(container.textContent).toContain(`×${FAN_LEGIBLE_MAX + 1}`);
  });

  it("says nothing extra about a run the fan can separate", () => {
    const pile = Array.from({ length: FAN_LEGIBLE_MAX }, (_, i) =>
      product({ id: `prd-pile-${i}` }),
    );
    const { container } = render(
      <MarginLadder floors={FLOORS} products={pile} />,
    );
    expect(container.textContent).not.toContain("×");
  });
});

describe("MarginLadder caption wiring", () => {
  it("prints no all-clear when there is nothing to plot", () => {
    const { container } = render(
      <MarginLadder floors={FLOORS} products={[]} />,
    );
    expect(container.textContent).not.toContain(ALL_CLEAR);
    expect(container.textContent).toContain("No products in this range");
  });

  it("prints no all-clear when there are no rails at all", () => {
    const { container } = render(
      <MarginLadder floors={[]} products={[clearSku, belowSku]} />,
    );
    expect(container.textContent).not.toContain(ALL_CLEAR);
    expect(container.textContent).toContain("Nothing is plotted");
  });

  it("still all-clears a real, fully checked range", () => {
    const { container } = render(
      <MarginLadder floors={FLOORS} products={[clearSku]} />,
    );
    expect(container.textContent).toContain(ALL_CLEAR);
  });

  it("still counts a real violation", () => {
    const { container } = render(
      <MarginLadder floors={FLOORS} products={[clearSku, belowSku]} />,
    );
    expect(container.textContent).toContain(
      "1 product is below their category floor",
    );
  });

  it("still caveats a product with no floor on file", () => {
    const { container } = render(
      <MarginLadder floors={FLOORS} products={[clearSku, homelessSku]} />,
    );
    expect(container.textContent).not.toContain(ALL_CLEAR);
    expect(container.textContent).toContain(
      "No plotted product is below its floor",
    );
  });
});

/**
 * A BELOW-FLOOR LABEL MUST NAME ITS OWN DOT.
 *
 * The labels used to be drawn at a FIXED `left-1/2 translate-x-4` while their
 * dots were fanned sideways by up to ±45px to escape each other. So on any rail
 * where a violation shared a cluster, the name sat over empty rail — or over a
 * NEIGHBOUR's dot, which is the failure that matters: below-floor SKUs are the
 * only thing this component exists to point at, and a label pointing at the
 * wrong one is worse than no label at all. Several violations on one rail made it
 * worse still: every label landed on the same offset AND within a few pixels of
 * the same height, so they printed on top of each other.
 *
 * Position is visual, so these assert the two invariants instead: a label's
 * horizontal offset IS its dot's, and no two labels on a rail share a row.
 */
const dot = (over: Partial<PlacedDot> = {}): PlacedDot => ({
  item: {
    id: "prd-a",
    sku: "BW-A",
    name: "Test Product",
    category: "Footwear",
    listPrice: 100,
    unitCost: 62,
  } satisfies LadderProduct,
  y: 40,
  xFraction: 0,
  margin: 0.38,
  belowFloor: true,
  ...over,
});

const named = (id: string, over: Partial<PlacedDot> = {}): PlacedDot =>
  dot({ ...over, item: { ...dot().item, id, sku: id, name: id } });

describe("placeLabels", () => {
  it("labels only the below-floor dots", () => {
    const labels = placeLabels([
      named("below-1", { belowFloor: true, y: 30 }),
      named("clear-1", { belowFloor: false, y: 120 }),
    ]);
    expect(labels.map((l) => l.item.id)).toEqual(["below-1"]);
  });

  it("copies each dot's fan offset onto its own label", () => {
    // A fanned cluster: same height, pushed apart sideways.
    const dots = [
      named("a", { y: 40, xFraction: 0 }),
      named("b", { y: 44, xFraction: 0.15 }),
      named("c", { y: 48, xFraction: -0.15 }),
    ];
    const labels = placeLabels(dots);
    for (const label of labels) {
      const own = dots.find((d) => d.item.id === label.item.id);
      expect(own).toBeDefined();
      expect(label.xFraction).toBe(own?.xFraction);
    }
  });

  it("gives every label on a rail its own row", () => {
    // Three violations within a few pixels — the case that produced the report.
    const labels = placeLabels([
      named("a", { y: 34, xFraction: 0 }),
      named("b", { y: 38, xFraction: 0.15 }),
      named("c", { y: 42, xFraction: -0.15 }),
    ]);
    const ys = labels.map((l) => l.y).sort((p, q) => p - q);
    expect(new Set(ys).size).toBe(labels.length);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LABEL_ROW_PX);
    }
  });

  it("leaves a lone label sitting on its dot rather than pushing it", () => {
    const [label] = placeLabels([named("a", { y: 40, xFraction: 0 })]);
    // Within half a line of the dot's own height: no separation was needed.
    expect(Math.abs(label.y - 40)).toBeLessThan(LABEL_ROW_PX / 2);
  });

  it("runs a right-fanned label's text back towards its rail", () => {
    const [right] = placeLabels([named("a", { xFraction: 0.3 })]);
    const [left] = placeLabels([named("b", { xFraction: -0.3 })]);
    expect(right.side).toBe("left");
    expect(left.side).toBe("right");
    // The OFFSET no longer lives in the transform — it goes through
    // `fanLeft(xFraction)` on `left`, in the same unit as the dot's. The transform
    // now carries only the gap and the side flip, so what is asserted here is that
    // a left-running label ENDS at its dot (`-100%`) while a right-running one
    // starts at it, and that each label still carries its own dot's offset (below).
    expect(labelTransform(right)).toContain("-100%");
    expect(labelTransform(left)).not.toContain("-100%");
    expect(fanLeft(right.xFraction)).not.toBe(fanLeft(left.xFraction));
    expect(right.xFraction).toBe(0.3);
    expect(left.xFraction).toBe(-0.3);
  });

  it("does not reorder the caller's dots", () => {
    const dots = [named("a", { y: 90 }), named("b", { y: 10 })];
    placeLabels(dots);
    expect(dots.map((d) => d.item.id)).toEqual(["a", "b"]);
  });
});

describe("MarginLadder below-floor label wiring", () => {
  // Footwear floor 40%; three SKUs land 0.5–1.5 points under it, close enough
  // that their dots collide and fan sideways.
  const FOOTWEAR: MarginFloor[] = [
    { category: "Footwear", floor: 0.4, target: 0.5 },
  ];
  const CLUSTER: Product[] = [
    product({
      id: "prd-alpha",
      name: "Alpha Trail",
      listPrice: 100,
      unitCost: 60.5,
    }),
    product({
      id: "prd-bravo",
      name: "Bravo Court",
      listPrice: 100,
      unitCost: 61,
    }),
    product({
      id: "prd-charlie",
      name: "Charlie Racer",
      listPrice: 100,
      unitCost: 61.5,
    }),
  ];
  const FIRST_WORDS = ["Alpha", "Bravo", "Charlie"];

  /**
   * The fan offset a dot is actually drawn at, read off `left: calc(N%)`.
   *
   * Read from `left`, not from `transform`: the offset is a FRACTION of the
   * column's width and goes through `fanLeft`, so the dot's transform carries only
   * the `translate(-50%, 50%)` centring. Scraping the transform for a `px` offset
   * is what this scraper used to do, and it found nothing once the unit changed.
   */
  const dotOffsets = (container: HTMLElement) => {
    const offsets = new Map<string, number>();
    for (const button of container.querySelectorAll("button[aria-label]")) {
      const label = button.getAttribute("aria-label") ?? "";
      if (!label.includes("below floor")) continue;
      const style = button.getAttribute("style") ?? "";
      const match = /left:\s*calc\((-?[\d.]+)%\)/.exec(style);
      expect(match, `no fan offset in dot left: ${style}`).not.toBeNull();
      // Back to the FRACTION the label also publishes. `fanLeft` renders
      // `calc(50% + N%)`, which CSS collapses to a single percentage, so 41%
      // means a fraction of -0.09. Comparing the label's fraction against the
      // dot's percentage directly is a unit mismatch that reads as a real
      // failure — convert here so the assertion compares like with like.
      const fraction = Number(
        (((match ? Number(match[1]) : 50) - 50) / 100).toFixed(4),
      );
      offsets.set(label.split(",")[0], fraction);
    }
    return offsets;
  };

  const labelNodes = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("span[data-fan-x]"));

  it("draws each label at its own dot's offset, one per row", () => {
    const { container } = render(
      <MarginLadder floors={FOOTWEAR} products={CLUSTER} />,
    );
    const dots = dotOffsets(container);
    expect(dots.size).toBe(3);
    // The dots really did fan — otherwise this test proves nothing.
    expect(new Set(dots.values()).size).toBe(3);

    const labels = labelNodes(container);
    expect(labels.map((el) => el.textContent).sort()).toEqual(FIRST_WORDS);

    const bottoms: number[] = [];
    for (const el of labels) {
      const word = el.textContent ?? "";
      const owner = [...dots.keys()].find((name) => name.startsWith(word));
      expect(owner, `no dot named ${word}`).toBeDefined();
      // THE INVARIANT: the label's offset is its dot's, not a constant.
      expect(Number(el.getAttribute("data-fan-x"))).toBe(dots.get(owner!));
      const bottom = /bottom:\s*(-?[\d.]+)px/.exec(
        el.getAttribute("style") ?? "",
      );
      expect(bottom, "label has no bottom").not.toBeNull();
      bottoms.push(Number(bottom?.[1]));
    }

    // ...and no two labels share a row, so none is printed over another.
    const ordered = [...bottoms].sort((p, q) => p - q);
    expect(new Set(ordered).size).toBe(3);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i] - ordered[i - 1]).toBeGreaterThanOrEqual(LABEL_ROW_PX);
    }
  });

  it("labels nothing in the compact transcript variant", () => {
    const { container } = render(
      <MarginLadder floors={FOOTWEAR} products={CLUSTER} compact />,
    );
    expect(labelNodes(container)).toHaveLength(0);
  });
});
