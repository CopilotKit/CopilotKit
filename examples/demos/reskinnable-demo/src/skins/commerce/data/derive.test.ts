import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_ORDER,
  EXCEPTION_FILTERS,
  FLOOR_WORKLIST_RANK,
  HOLD_REASONS,
  LADDER_ABOVE_FLOOR,
  LADDER_BELOW_FLOOR,
  LADDER_CEILING,
  LADDER_FLOOR_RATIO,
  ORDER_EXCEPTION_LABEL,
  belowFloorCount,
  countBelow,
  discountedPrice,
  ladderRatio,
  marginAt,
  marginPosition,
  noFloorCaveat,
  noMarkdownFloorCaveat,
  nullableBelowFloor,
  productFloorStatus,
  productMargin,
  promotionFloorStatus,
  refundCeilingLabel,
  refundGuidance,
  tallyFloorStatus,
  tallyStatuses,
  weeksOfCover,
  windowLabel,
} from "./derive";
import { SEED_FLOORS, SEED_PRODUCTS } from "./seed";
import { ORDER_EXCEPTIONS } from "./types";
import type { MarginFloor, Product, Promotion } from "./types";

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
  unitCost: 88,
  inventory: 480,
  trailing30Units: 388,
  status: "live",
  vendor: "Vela Footworks",
  ...over,
});

/**
 * BEAT 3c's completeness invariant.
 *
 * This is the one assertion in the file that is about STAGECRAFT rather than
 * arithmetic, and it is here because the failure it guards is invisible: an
 * exception value the agent can set but the page has no control for filters the
 * rows perfectly and lights nothing up, so the audience sees a filtered list
 * with nothing on screen crediting the assistant. That shipped once, for three
 * of seven values.
 */
describe("EXCEPTION_FILTERS", () => {
  it("offers a control for every real exception, plus all/any", () => {
    const real = ORDER_EXCEPTIONS.filter((e) => e !== "none");
    expect([...EXCEPTION_FILTERS]).toEqual(["all", "any", ...real]);
  });

  it("drops `none`, which `all` already expresses", () => {
    expect(EXCEPTION_FILTERS).not.toContain("none");
  });

  /**
   * The same invariant for the WRITE side. `HOLD_REASONS` is asserted into the
   * non-empty tuple `z.enum()` needs, which is the one thing `filter` cannot
   * prove — so its membership and its non-emptiness are pinned here instead.
   */
  it("holds an order for every real exception and for nothing else", () => {
    expect([...HOLD_REASONS]).toEqual(
      ORDER_EXCEPTIONS.filter((e) => e !== "none"),
    );
    expect(HOLD_REASONS.length).toBeGreaterThan(0);
    expect(HOLD_REASONS).not.toContain("none");
  });

  it("labels every filter it offers", () => {
    const labels: Record<string, string> = {
      all: "All",
      any: "Any exception",
      ...ORDER_EXCEPTION_LABEL,
    };
    for (const filter of EXCEPTION_FILTERS) {
      expect(labels[filter]).toBeTruthy();
    }
  });
});

describe("margin arithmetic", () => {
  it("computes margin at a price and guards a zero or negative price", () => {
    expect(marginAt(100, 40)).toBeCloseTo(0.6, 5);
    expect(marginAt(0, 40)).toBe(0);
    expect(marginAt(-10, 40)).toBe(0);
  });

  it("prices a discount to the cent", () => {
    expect(discountedPrice(128, 40)).toBe(76.8);
    expect(discountedPrice(240, 35)).toBe(156);
    expect(discountedPrice(100, 0)).toBe(100);
  });

  it("mirrors the store: clamped ratio, RAW below-floor test", () => {
    // The split is the whole reason both exist. Clamping positions the dot on
    // the ladder rail; it must never be allowed to hide a violation.
    const under = marginPosition(FLOORS, "Footwear", 0.2);
    expect(under?.ratio).toBe(0);
    expect(under?.belowFloor).toBe(true);

    const over = marginPosition(FLOORS, "Footwear", LADDER_CEILING + 0.1);
    expect(over?.ratio).toBe(1);
    expect(over?.belowFloor).toBe(false);

    // Exactly at the floor is NOT a violation — the gate is `<`, not `<=`.
    const atFloor = marginPosition(FLOORS, "Footwear", 0.4);
    expect(atFloor?.belowFloor).toBe(false);
    expect(atFloor?.ratio).toBe(0);
  });

  it("returns null for a category with no floor on file", () => {
    expect(marginPosition(FLOORS, "Home", 0.5)).toBeNull();
  });

  it("flags the seeded Lark Runner shape as below its floor", () => {
    const lark = product(); // 145 / 88 → 39.3% against a 40% Footwear floor
    expect(productMargin(lark)).toBeCloseTo(0.393, 3);
    expect(productFloorStatus(FLOORS, lark)).toBe("below");
  });
});

/**
 * A MISSING FLOOR MUST NEVER READ AS COMPLIANT.
 *
 * `isBelowFloor` used to end `?? false`, so a product whose category had no floor
 * on file came back `false` — indistinguishable from "checked, and fine". Every
 * consumer then painted the worst possible answer: a green `belowFloorSkus: 0`
 * all-clear on the exact figure this skin's signature visual and its beat-6 gate
 * are about. The server refuses to guess the same condition at all
 * (`store.floorFor` throws `UNKNOWN_CATEGORY` rather than return a zeroed floor
 * that "would make every margin look healthy"), so the client asserted the
 * opposite of what the server would not even assume.
 *
 * These assertions are the whole reason `FloorStatus` has three values.
 */
describe("a category with no floor on file", () => {
  const homeless = product({ category: "Home" }); // no Home floor in FLOORS

  it("is reported as unknown, and specifically NOT as clear", () => {
    const status = productFloorStatus(FLOORS, homeless);
    expect(status).toBe("unknown");
    expect(status).not.toBe("clear");
    // The old boolean shape, restated: nothing may coerce this to "compliant".
    expect(nullableBelowFloor(status)).toBeNull();
    expect(nullableBelowFloor(status)).not.toBe(false);
  });

  it("does NOT produce a `belowFloorSkus: 0` all-clear", () => {
    // One unmeasurable SKU and nothing else: the count a KPI card or the
    // sandbox's getTradingKpis would publish must be null, never 0.
    expect(belowFloorCount(FLOORS, [homeless])).toBeNull();
    expect(belowFloorCount(FLOORS, [homeless])).not.toBe(0);

    // And it still refuses a number when there ARE known violations mixed in —
    // a partial count presented as the count is the same lie in a smaller font.
    expect(belowFloorCount(FLOORS, [homeless, product()])).toBeNull();
  });

  it("is tallied apart from the compliant products, never folded into them", () => {
    const clear = product({ listPrice: 200, unitCost: 80 }); // 60% vs 40% floor
    const tally = tallyFloorStatus(FLOORS, [homeless, clear, product()]);
    expect(tally).toEqual({ below: 1, clear: 1, unknown: 1 });
  });

  it("has a caveat to render, so a consumer can say why", () => {
    expect(noFloorCaveat(0)).toBeNull();
    expect(noFloorCaveat(1)).toContain("1 SKU");
    expect(noFloorCaveat(3)).toContain("3 SKUs");
    // The promotions desk counts MARKDOWNS, and its caveat has to name them —
    // a sentence about SKUs sends the reader to the wrong page.
    expect(noMarkdownFloorCaveat(1)).toContain("1 markdown has");
    expect(noMarkdownFloorCaveat(2)).toContain("2 markdowns have");
    expect(noMarkdownFloorCaveat(0)).toBeNull();
  });

  it("withholds the headline figure for ANY set of verdicts, not just products", () => {
    // `countBelow` is what the promotions desk counts markdowns with. Same rule,
    // one implementation: an unknown anywhere in the set means no defensible
    // total, and a below-floor row still reports itself.
    expect(countBelow(tallyStatuses(["below", "clear"]))).toBe(1);
    expect(countBelow(tallyStatuses(["below", "unknown"]))).toBeNull();
    expect(countBelow(tallyStatuses(["unknown"]))).not.toBe(0);
    expect(countBelow(tallyStatuses([]))).toBe(0);
  });

  it("ranks an unchecked row above the cleared ones on every worklist", () => {
    // Both the catalog's rows and the promotions desk's cards sort by this, so a
    // row nobody verified cannot sink beneath the rows that were.
    const { below, unknown, clear } = FLOOR_WORKLIST_RANK;
    expect(below).toBeLessThan(unknown);
    expect(unknown).toBeLessThan(clear);
  });

  it("treats a markdown on it as unknown rather than approvable", () => {
    const promotion: Promotion = {
      id: "promo-x",
      name: "Test markdown",
      productId: homeless.id,
      discountPercent: 40,
      startsAt: "2026-01-01",
      endsAt: "2026-01-14",
      submittedBy: "op-nadia",
      submittedAt: "2026-01-01T00:00:00.000Z",
      status: "pending",
      marginWaiverId: null,
    };
    expect(promotionFloorStatus(FLOORS, homeless, promotion)).toBe("unknown");
    // A markdown whose product cannot be resolved is equally unknown, not clear.
    expect(promotionFloorStatus(FLOORS, undefined, promotion)).toBe("unknown");
    // …while a real floor still decides normally: 145 at −40% is 24.7% margin.
    expect(promotionFloorStatus(FLOORS, product(), promotion)).toBe("below");
  });
});

describe("normal data is unchanged by the tri-state", () => {
  it("still finds exactly the two seeded below-floor products", () => {
    const floors = [...SEED_FLOORS];
    const products = [...SEED_PRODUCTS];
    const tally = tallyFloorStatus(floors, products);
    expect(tally.unknown).toBe(0);
    expect(tally.below).toBe(2);
    expect(tally.clear).toBe(SEED_PRODUCTS.length - 2);

    // The headline figure is a real number — the em-dash path is for a broken
    // ledger only, and must not appear on the seeded demo.
    expect(belowFloorCount(floors, products)).toBe(2);

    const below = products.filter(
      (p) => productFloorStatus(floors, p) === "below",
    );
    expect(below.map((p) => p.id).sort()).toEqual([
      "prd-harbor-parka",
      "prd-lark-runner",
    ]);
  });

  it("maps a checked product onto the boolean the model used to get", () => {
    expect(nullableBelowFloor(productFloorStatus(FLOORS, product()))).toBe(
      true,
    );
    expect(
      nullableBelowFloor(
        productFloorStatus(FLOORS, product({ listPrice: 200, unitCost: 80 })),
      ),
    ).toBe(false);
  });

  it("gives an empty range a real zero, not an unknown", () => {
    // No products means nothing went unchecked — an all-clear here is honest.
    expect(belowFloorCount(FLOORS, [])).toBe(0);
  });
});

describe("weeksOfCover", () => {
  it("computes weeks of cover at the trailing-30 run rate", () => {
    // 480 on hand / (388 per 4.33 weeks) ≈ 5.4 weeks
    expect(weeksOfCover(product())).toBeCloseTo(5.4, 1);
  });

  it("returns null rather than Infinity for a product selling nothing", () => {
    expect(weeksOfCover(product({ trailing30Units: 0 }))).toBeNull();
  });
});

/**
 * WINDOW LABELS ARE CALENDAR ARITHMETIC, AND THE CLOCK IS PINNED TO PROVE IT.
 *
 * `startsAt`/`endsAt` are date-only `YYYY-MM-DD` strings minted in UTC by
 * `store.daysFromNowDate`, so they denote a DAY. `daysUntil` used to subtract
 * one from `Date.now()` — an instant — and round, which made every label move
 * with the wall clock: past 12:00:00 UTC a window ending today crossed −0.5 days
 * and rounded to −1, so the promotions page and the agent both narrated "ended
 * yesterday" on the day it ends. No seeded window ends today, so the seed hid
 * it, and it only reproduced in the afternoon.
 *
 * Hence the two pinned times below. 00:30 UTC and 23:30 UTC sit on either side
 * of that old 12:00 flip, so the SAME window must produce the SAME label at
 * both — that equality is the regression, and a wobble of ±1 anywhere in the
 * table fails it. Exact day counts (not shapes) are assertable precisely
 * because the clock no longer leaks in.
 */
describe("windowLabel", () => {
  /** The anchor "today", 2026-08-10, in UTC. */
  const TODAY_UTC = Date.UTC(2026, 7, 10);

  /** Date-only, UTC — exactly how `store.daysFromNowDate` writes these. */
  const isoDate = (offsetDays: number) =>
    new Date(TODAY_UTC + offsetDays * 86_400_000).toISOString().slice(0, 10);

  /** Move the pinned clock within that same UTC day. */
  const at = (hour: number, minute: number) =>
    vi.setSystemTime(new Date(TODAY_UTC + hour * 3_600_000 + minute * 60_000));

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Straddles the old rounding flip: at 00:30 a same-day window rounded to 0,
  // at 23:30 to −1.
  const TIMES: ReadonlyArray<readonly [string, number, number]> = [
    ["00:30 UTC", 0, 30],
    ["23:30 UTC", 23, 30],
  ];

  for (const [when, hour, minute] of TIMES) {
    describe(`at ${when}`, () => {
      beforeEach(() => at(hour, minute));

      it("says a window ending today ENDS today, not that it ended yesterday", () => {
        expect(windowLabel(isoDate(-6), isoDate(0))).toBe("ends today");
      });

      it("says a one-day window ends today, not merely that it started", () => {
        expect(windowLabel(isoDate(0), isoDate(0))).toBe("ends today");
      });

      it("counts a future window in whole calendar days", () => {
        expect(windowLabel(isoDate(6), isoDate(27))).toBe("starts in 6 days");
        expect(windowLabel(isoDate(1), isoDate(9))).toBe("starts tomorrow");
      });

      it("still opens a window that starts today and runs on", () => {
        expect(windowLabel(isoDate(0), isoDate(5))).toBe("starts today");
      });

      it("counts a live window's remaining days", () => {
        expect(windowLabel(isoDate(-2), isoDate(5))).toBe(
          "live, ends in 5 days",
        );
      });

      it("counts a past window back from yesterday", () => {
        expect(windowLabel(isoDate(-6), isoDate(-1))).toBe("ended yesterday");
        expect(windowLabel(isoDate(-30), isoDate(-7))).toBe("ended 7 days ago");
      });
    });
  }

  it("gives a window ONE label whatever the hour", () => {
    const labels = new Set<string>();
    for (let hour = 0; hour < 24; hour += 1) {
      at(hour, 30);
      labels.add(windowLabel(isoDate(-6), isoDate(0)));
    }
    expect([...labels]).toEqual(["ends today"]);
  });
});

/**
 * THE LADDER'S ONE INVARIANT.
 *
 * The margin ladder's entire claim is that every category's floor line sits at
 * the SAME height, so "how far am I from the line I may not cross" is comparable
 * across categories at a glance. That is a property of `ladderRatio` alone, and
 * it is the kind of property that breaks silently: a per-category term slipped
 * into the denominator still renders a plausible chart. It shipped broken once —
 * normalizing each rail over `[floor - 0.12, LADDER_CEILING]` put Home's floor at
 * 24.5% of the rail and Accessories' at 37.5%, ~30px apart on a 232px rail, so
 * the two seeded violations did not line up.
 */
describe("ladderRatio", () => {
  const RAIL = 232; // the full-size rail, in px

  it("puts the floor at ONE height on every rail, whatever the floor is", () => {
    const positions = SEED_FLOORS.map((f) => ladderRatio(f.floor, f.floor));

    // Every seeded floor — 38% through 55% — maps to the same spot…
    expect(new Set(positions).size).toBe(1);
    // …which is the exported constant the component draws the line at.
    expect(positions[0]).toBe(LADDER_FLOOR_RATIO);

    // Stated in the pixels that actually matter: no spread at all.
    const pixels = positions.map((r) => r * RAIL);
    expect(Math.max(...pixels) - Math.min(...pixels)).toBe(0);
  });

  it("holds for floors far outside the seeded range", () => {
    // Not a property of these five numbers — a property of the mapping.
    for (const floor of [0, 0.05, 0.2, 0.38, 0.55, 0.8, 0.95]) {
      expect(ladderRatio(floor, floor)).toBeCloseTo(LADDER_FLOOR_RATIO, 12);
    }
  });

  it("gives one margin point the same pixels on every rail", () => {
    // The other half of a shared axis: equal DISTANCE from the floor must be
    // equal distance on screen, or "2 points under" reads differently by column.
    for (const delta of [-0.04, -0.005, 0, 0.03, 0.18]) {
      const ratios = SEED_FLOORS.map((f) =>
        ladderRatio(f.floor + delta, f.floor),
      );
      expect(new Set(ratios.map((r) => r.toFixed(12))).size).toBe(1);
    }
  });

  it("draws a violation below the shared floor line and a healthy SKU above", () => {
    const home = { floor: 0.38 };
    const accessories = { floor: 0.55 };
    // The two seeded violations: Harbor Parka is 0.57pt under a 42% floor and
    // Lark Runner 0.69pt under a 40% floor.
    expect(ladderRatio(0.4143, 0.42)).toBeLessThan(LADDER_FLOOR_RATIO);
    expect(ladderRatio(0.3931, 0.4)).toBeLessThan(LADDER_FLOOR_RATIO);
    // …and they land within a pixel of each other, which is the comparison the
    // ladder exists to make.
    const gap =
      Math.abs(ladderRatio(0.4143, 0.42) - ladderRatio(0.3931, 0.4)) * RAIL;
    expect(gap).toBeLessThan(1);

    expect(ladderRatio(home.floor + 0.05, home.floor)).toBeGreaterThan(
      LADDER_FLOOR_RATIO,
    );
    expect(
      ladderRatio(accessories.floor + 0.05, accessories.floor),
    ).toBeGreaterThan(LADDER_FLOOR_RATIO);
  });

  it("clamps to the rail rather than escaping it", () => {
    expect(ladderRatio(0.4 - LADDER_BELOW_FLOOR - 0.5, 0.4)).toBe(0);
    expect(ladderRatio(0.4 + LADDER_ABOVE_FLOOR + 0.5, 0.4)).toBe(1);
  });

  it("keeps every seeded product and target inside the plotted range", () => {
    // The headrooms are sized to this data; if a future seed puts a SKU outside
    // them it clamps to an end of the rail and stops being readable. Assert on
    // the RAW ratio, since the clamp is exactly what would hide the problem.
    for (const floor of SEED_FLOORS) {
      const span = LADDER_BELOW_FLOOR + LADDER_ABOVE_FLOOR;
      const raw = (margin: number) =>
        (margin - floor.floor + LADDER_BELOW_FLOOR) / span;

      expect(raw(floor.target)).toBeGreaterThan(0);
      expect(raw(floor.target)).toBeLessThan(1);

      for (const item of SEED_PRODUCTS.filter(
        (p) => p.category === floor.category,
      )) {
        const margin = marginAt(item.listPrice, item.unitCost);
        expect(raw(margin), `${item.name} is off the rail`).toBeGreaterThan(0);
        expect(raw(margin), `${item.name} is off the rail`).toBeLessThan(1);
      }
    }
  });
});

describe("CATEGORY_ORDER", () => {
  it("is a stable presentation order shared by every surface", () => {
    // The ladder, the catalog filter and the canvas brief all read this. If they
    // disagreed, two views of the same range would look like two ranges.
    expect([...CATEGORY_ORDER]).toEqual([
      "Outerwear",
      "Knitwear",
      "Footwear",
      "Accessories",
      "Home",
    ]);
  });
});

/**
 * BEAT 3a's control, where the guidance and the rule meet.
 *
 * The bug this pins: the placeholder printed `formatMoney(itemValue)` — rounded
 * to whole dollars — while the button compared the typed amount EXACTLY against
 * `itemValue`. On a $152.50 return the card invited "up to $153" and then refused
 * 153 with a disabled button and no explanation. The app's own instruction was
 * the thing that misled the operator, which is worse than a wrong number.
 *
 * No seeded return has cents today (340, 96, 152, 96, 290 — `SEED_RETURNS`
 * requires a whole number of units at the order line's price, and every seeded
 * `unitPrice` is whole), so the defect is LATENT. It stops being latent the
 * moment any price carries cents, and `store.issueRefund` already stores refunds
 * to the cent.
 */
/** What an operator reading the placeholder would actually type. */
const invitedFigure = (placeholder: string) =>
  placeholder.replace(/[^0-9.]/g, "");

describe("refundGuidance", () => {
  it("accepts the amount its own placeholder invites, to the cent", () => {
    for (const itemValue of [152.5, 96.99, 340, 0.05, 1234.56]) {
      const { placeholder } = refundGuidance(itemValue, "");
      const typed = invitedFigure(placeholder);
      const invited = refundGuidance(itemValue, typed);
      expect(invited.valid, `${placeholder} refused "${typed}"`).toBe(true);
      expect(invited.amount).toBe(itemValue);
    }
  });

  it("states the ceiling once — the placeholder is built from the label", () => {
    // Two figures for one `itemValue` is the same defect wearing a different
    // hat: the row column, the "Charged …" label and the placeholder all print
    // this, and a rounded one next to an exact one contradicts the instruction.
    const { placeholder, ceiling } = refundGuidance(152.5, "");
    expect(ceiling).toBe("$152.50");
    expect(ceiling).toBe(refundCeilingLabel(152.5));
    expect(placeholder).toBe("up to $152.50");
    expect(placeholder).toContain(ceiling);
  });

  it("keeps whole-dollar ceilings free of noise cents", () => {
    // The seeded demo values are whole, and the fix must not repaint them as
    // "$340.00" on stage.
    expect(refundGuidance(340, "").placeholder).toBe("up to $340");
  });

  it("mirrors the store's range rule and nothing more", () => {
    // `store.issueRefund`: > 0 and <= itemValue. The UI states it; the store
    // owns it.
    expect(refundGuidance(152.5, "152.51").valid).toBe(false);
    expect(refundGuidance(152.5, "0").valid).toBe(false);
    expect(refundGuidance(152.5, "").valid).toBe(false);
    expect(refundGuidance(152.5, "abc").valid).toBe(false);
    expect(refundGuidance(152.5, "$40.25").valid).toBe(true);
    expect(refundGuidance(152.5, "$40.25").amount).toBe(40.25);
  });

  /**
   * THE CLASS: a typo must be REFUSED, never silently rewritten into a
   * different figure that then passes every rule.
   *
   * `Number(typed.replace(/[^0-9.]/g, ""))` — the original spelling — deleted
   * whatever it did not recognise and kept going, so on the one path in this app
   * that moves money a slip became a valid instruction: `-50` was issued as a
   * real $50 refund, and `1e5` as $15. The store cannot catch either; both are
   * finite, positive and under the ceiling by the time it sees them.
   */
  it("refuses a malformed figure instead of rewriting it", () => {
    for (const typed of [
      "-50", // a sign is a different number — this was $50
      "+50",
      "1e5", // the `e` vanished and the digits joined — this was $15
      "1E5",
      "50.00.1", // two dots — this was $50.001
      "5 0", // internal space — this was $50
      "50px",
      "50$", // a trailing symbol is not formatting this app prints
      "1,23", // grouping no locale writes — this was $123
      "1,2,3",
      ",50",
      "abc",
      ".",
      "$",
    ]) {
      const { amount, valid, empty, problem } = refundGuidance(152.5, typed);
      expect(valid, `"${typed}" was accepted`).toBe(false);
      expect(Number.isFinite(amount), `"${typed}" produced a figure`).toBe(
        false,
      );
      expect(empty, `"${typed}" read as untyped`).toBe(false);
      expect(problem, `"${typed}" was refused silently`).toBeTruthy();
    }
  });

  it("tolerates the formatting its own labels use", () => {
    // Everything here is the SAME number as written, only dressed: surrounding
    // space, the leading `$` the placeholder prints, and the thousands comma
    // `formatMoneyExact` emits.
    expect(refundGuidance(152.5, "  50  ")).toMatchObject({
      amount: 50,
      valid: true,
    });
    expect(refundGuidance(152.5, "$50")).toMatchObject({
      amount: 50,
      valid: true,
    });
    expect(refundGuidance(152.5, "$ 50")).toMatchObject({
      amount: 50,
      valid: true,
    });
    expect(refundGuidance(2000, "1,234.56")).toMatchObject({
      amount: 1234.56,
      valid: true,
    });
    // Mid-typing shapes that are unambiguous as written.
    expect(refundGuidance(152.5, "50.")).toMatchObject({
      amount: 50,
      valid: true,
    });
    expect(refundGuidance(152.5, ".5")).toMatchObject({
      amount: 0.5,
      valid: true,
    });
  });

  it("tells an untyped input apart from a refused one", () => {
    // A control the operator has not touched must not be scolded; the button is
    // disabled either way, but only one of the two is a mistake.
    for (const blank of ["", "   "]) {
      const guidance = refundGuidance(152.5, blank);
      expect(guidance.valid).toBe(false);
      expect(guidance.empty).toBe(true);
      expect(guidance.problem).toBeNull();
    }
    const refused = refundGuidance(152.5, "-50");
    expect(refused.empty).toBe(false);
    expect(refused.problem).toBeTruthy();
  });

  it("says the range out loud when the figure is readable but out of range", () => {
    // Readable, so the operator gets the ceiling rather than "unreadable" —
    // still a MIRROR of `store.issueRefund`, never a second authority.
    const over = refundGuidance(152.5, "152.51");
    expect(over.amount).toBe(152.51);
    expect(over.valid).toBe(false);
    expect(over.problem).toContain("$152.50");
    expect(refundGuidance(152.5, "0").problem).toContain("$152.50");
  });
});
