/**
 * Pure derivations shared by the pages, the gen-UI components, the agent's
 * readables and the sandbox functions.
 *
 * These deliberately DO NOT import `store.ts`. The store is the server's
 * in-memory ledger; importing it from a client component would bundle the whole
 * seed into the browser and create a second, silently divergent copy of the
 * data — so everything here takes the floors it needs as an argument, sourced
 * from the one snapshot the ledger context fetched.
 */

import { CATEGORIES, ORDER_EXCEPTIONS, ORDER_STATUSES } from "./types";
import type {
  Category,
  MarginFloor,
  MarginPosition,
  Order,
  OrderException,
  Product,
  Promotion,
  ReturnReason,
  ReturnRequest,
} from "./types";

const DAY_MS = 86_400_000;

/**
 * The order categories are presented in, everywhere. Re-exported from `types`
 * so a component never has to reach past `derive` for one constant — and so the
 * ladder, the catalog filter and the canvas brief can never disagree about the
 * order, which would make two views of the same range look like two ranges.
 */
export const CATEGORY_ORDER: readonly Category[] = CATEGORIES;

/**
 * Must match `store.LADDER_CEILING` — the top of the `marginPosition` scale.
 *
 * NOT the top of a ladder rail: the ladder plots the floor-relative axis below
 * (`ladderRatio`), which has no absolute ceiling. This constant belongs to
 * `marginPosition`, whose per-row bar fills from that category's floor up to a
 * shared absolute ceiling.
 */
export const LADDER_CEILING = 0.75;

/**
 * THE LADDER AXIS — floor-relative, and therefore genuinely SHARED.
 *
 * Every rail plots `margin - floor` on ONE axis spanning
 * `[-LADDER_BELOW_FLOOR, +LADDER_ABOVE_FLOOR]` margin points. Two consequences,
 * and they are the ladder's whole thesis:
 *
 *  - the floor lands at `LADDER_FLOOR_RATIO` on EVERY rail, whether that
 *    category's floor is 38% or 55%, so "under its floor" is one height across
 *    the range and the two seeded violations line up;
 *  - one margin point is the same number of pixels on every rail and on both
 *    sides of the line, so "8 points under" and "1 point under" are as far apart
 *    as they sound.
 *
 * An earlier version normalized each rail over `[floor - 0.12, LADDER_CEILING]`,
 * which is what NOT to do: the span shrinks as the floor rises, so the floor
 * line drifted from 24.5% of the rail (Home, 38%) to 37.5% (Accessories, 55%) —
 * a ~30px spread on a 232px rail, and no cross-category comparison at all.
 *
 * The two headrooms are sized to the range they have to hold without clamping:
 * the widest seeded margin sits 18.3 points over its floor and the most generous
 * target 12 points over, so 24 points of room above; violations are fractions of
 * a point, so 6 points below is ample and keeps the pixels-per-point scale
 * usefully tight.
 *
 * The ladder needs this rather than `marginPosition`'s ratio because that helper
 * clamps at the floor — right for a row's bar, wrong for a rail, where a stack
 * of violations pinned to one line cannot show how far under they are.
 */
export const LADDER_BELOW_FLOOR = 0.06;
export const LADDER_ABOVE_FLOOR = 0.24;
const LADDER_SPAN = LADDER_BELOW_FLOOR + LADDER_ABOVE_FLOOR;

/**
 * Where the floor line sits on every rail, 0 at the base and 1 at the top.
 * A CONSTANT — that is the point. Equal to `ladderRatio(f, f)` for any `f`.
 */
export const LADDER_FLOOR_RATIO = LADDER_BELOW_FLOOR / LADDER_SPAN;

/**
 * Where a margin sits on a ladder rail, 0 at the rail's base and 1 at its top.
 * Clamped, so a value outside the plotted range pins to an end rather than
 * escaping the rail.
 */
export function ladderRatio(margin: number, floor: number): number {
  const raw = (margin - floor + LADDER_BELOW_FLOOR) / LADDER_SPAN;
  return Math.min(1, Math.max(0, raw));
}

export const formatMoney = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/** Keeps the cents when a refund or a discounted price actually has them. */
export const formatMoneyExact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);

/**
 * BEAT 3a's refund ceiling, as the app STATES it — always exact.
 *
 * Every surface that prints "what was charged" for a return goes through this
 * one function, so the goodwill card and the returns row cannot render the same
 * `itemValue` as two different figures.
 */
export const refundCeilingLabel = (itemValue: number) =>
  formatMoneyExact(itemValue);

/**
 * BEAT 3a's refund control, resolved: the figure the input INVITES and the rule
 * that ACCEPTS it, derived together from one `itemValue` so they cannot disagree.
 *
 * They used to be written apart, and they drifted the worst way round. The
 * placeholder printed `formatMoney(itemValue)`, which ROUNDS to whole dollars,
 * while the button compared the typed amount EXACTLY against `itemValue` (the
 * same ceiling `store.issueRefund` enforces as `REFUND_EXCEEDS_VALUE`). On a
 * return charged $152.50 the app therefore invited "up to $153" and then sat
 * there with the button disabled and nothing on screen saying why — the app's
 * own instruction was the thing that misled the operator.
 *
 * `amount` is what to submit; it is only meaningful when `valid`. The range rule
 * is stated here for the UI's benefit only — the STORE owns it (`http.ts` refuses
 * a non-number at the boundary, `store.issueRefund` owns `> 0` / `<= itemValue`),
 * and this must stay a mirror of it, never a second authority.
 */
export function refundGuidance(itemValue: number, typed: string) {
  const ceiling = refundCeilingLabel(itemValue);
  const amount = parseMoneyFigure(typed);
  const readable = Number.isFinite(amount);
  const valid = readable && amount > 0 && amount <= itemValue;
  return {
    /** The charged figure, for any label that prints it. */
    ceiling,
    /** The input's placeholder — built FROM `ceiling`, so it states the same figure. */
    placeholder: `up to ${ceiling}`,
    amount,
    valid,
    /**
     * Nothing has been typed yet. `valid` is `false` either way, but this is the
     * ONE reason for it that is not the operator's mistake — a control nobody
     * has touched must not be scolded.
     */
    empty: typed.trim().length === 0,
    /**
     * Why the figure was refused, as a sentence to put next to the input. `null`
     * when there is nothing to say — the figure is good, or nothing is typed.
     *
     * A disabled button and no explanation is the exact failure this function's
     * header was written about; a refusal the operator cannot see is only half a
     * fix. Still a MIRROR: it restates the ceiling the placeholder already
     * states, and decides nothing.
     */
    problem: refundProblem({ valid, readable, typed, ceiling }),
  };
}

/**
 * ONE money figure as typed, or `NaN` when the input is not one.
 *
 * WHY THIS IS NOT A `.replace(/[^0-9.]/g, "")`. That was the original spelling,
 * and on the one path in this app that moves money it turned a typo into a
 * DIFFERENT, fully valid instruction: `-50` was issued as a real $50 refund and
 * `1e5` as $15 (the `e` deleted, the digits joined). Neither can be caught
 * downstream — by the time `store.issueRefund` sees them they are finite,
 * positive and under the ceiling — and `""` and `"abc"` both coerced to `0`, so a
 * refusal could not be told from an untouched field either.
 *
 * The rule, then: tolerate FORMATTING, refuse a DIFFERENT NUMBER.
 *
 * | Input                  | Verdict   | Why                                     |
 * | ---------------------- | --------- | --------------------------------------- |
 * | `"  50  "`             | `50`      | surrounding space is not a character     |
 * | `"$50"`, `"$ 50"`      | `50`      | one LEADING `$` — how `placeholder` and  |
 * |                        |           | the "Charged …" label print the ceiling  |
 * | `"1,234.56"`           | `1234.56` | grouped exactly as `formatMoneyExact`    |
 * |                        |           | prints it, so it is what gets copied     |
 * | `"40.25"`, `"50."`, `".5"` | as written | unambiguous decimal, mid-typing    |
 * |                        |           | shapes included                          |
 * | `"40.255"`             | `40.255`  | over-precise, NOT malformed — the store  |
 * |                        |           | rounds to cents and owns that            |
 * | `"-50"`, `"+50"`       | REFUSED   | a sign is a different number             |
 * | `"1e5"`, `"1E5"`       | REFUSED   | an exponent is a different number        |
 * | `"50.00.1"`            | REFUSED   | two dots name no figure                  |
 * | `"1,23"`, `"1,2,3"`, `",50"` | REFUSED | grouping no locale writes; keeping |
 * |                        |           | the digits alone silently means `123`    |
 * | `"5 0"`, `"50px"`, `"50$"`, `"abc"` | REFUSED | stray characters mean the  |
 * |                        |           | input was not the figure it looks like   |
 * | `""`, `"   "`, `"$"`, `"."` | REFUSED | no digit at all (`empty` above tells |
 * |                        |           | the untyped case apart for the UI)       |
 *
 * `NaN` rather than `null` is the refusal, so `amount` stays a `number` for both
 * consumers: a caller that ignored `valid` and submitted it would be refused
 * again at the boundary (`http.requireAmount` rejects a non-finite number),
 * never quietly charged a figure nobody typed.
 */
const MONEY_FIGURE = /^(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d*)?$/;

function parseMoneyFigure(typed: string): number {
  const trimmed = typed.trim();
  // A single LEADING currency symbol only — that is the one place our own labels
  // put it. A trailing or repeated `$` is a stray character like any other.
  const bare = (
    trimmed.startsWith("$") ? trimmed.slice(1) : trimmed
  ).trimStart();
  // A figure needs a digit: this is what refuses "", "$" and "." before the
  // shape test, which would otherwise accept all three as an empty match.
  if (!/\d/.test(bare)) return NaN;
  if (!MONEY_FIGURE.test(bare)) return NaN;
  const amount = Number(bare.replace(/,/g, ""));
  // A digit string long enough to overflow to Infinity is not a figure either.
  return Number.isFinite(amount) ? amount : NaN;
}

function refundProblem({
  valid,
  readable,
  typed,
  ceiling,
}: {
  valid: boolean;
  readable: boolean;
  typed: string;
  ceiling: string;
}): string | null {
  if (valid || typed.trim().length === 0) return null;
  if (!readable)
    return "That is not an amount I can read — type a figure like 40.25.";
  return `Enter an amount over $0 and no more than ${ceiling}.`;
}

/** "$2.3k" — for axis labels and dense chips where the full figure won't fit. */
export const formatCompact = (n: number) =>
  n >= 1000
    ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
    : `$${Math.round(n)}`;

export const formatPercent = (ratio: number) => `${Math.round(ratio * 100)}%`;

/** One decimal — margins live in a narrow band and whole percent hides moves. */
export const formatMargin = (ratio: number) => `${(ratio * 100).toFixed(1)}%`;

export function floorFor(
  floors: MarginFloor[],
  category: Category,
): MarginFloor | undefined {
  return floors.find((f) => f.category === category);
}

/** Gross margin at a given price. Guards a zero price rather than dividing by it. */
export function marginAt(price: number, unitCost: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  return (price - unitCost) / price;
}

/** The price a discount actually sells at. Rounded to cents, not to dollars. */
export function discountedPrice(
  listPrice: number,
  discountPercent: number,
): number {
  return Math.round(listPrice * (1 - discountPercent / 100) * 100) / 100;
}

/**
 * Where a margin sits against its category floor. Mirrors `store.marginPosition`
 * exactly — including the split between the CLAMPED `ratio` (which positions the
 * dot on the rail) and the RAW `belowFloor` test (which decides whether it is
 * flagged). Clamping the ratio must never be allowed to hide a violation.
 */
export function marginPosition(
  floors: MarginFloor[],
  category: Category,
  margin: number,
): MarginPosition | null {
  const policy = floorFor(floors, category);
  if (!policy) return null;
  const span = LADDER_CEILING - policy.floor;
  const raw = span === 0 ? 0.5 : (margin - policy.floor) / span;
  return {
    category,
    margin,
    floor: policy.floor,
    target: policy.target,
    ratio: Math.min(1, Math.max(0, raw)),
    belowFloor: margin < policy.floor,
  };
}

/** A product's margin at LIST price — the figure the catalog and ladder show. */
export function productMargin(item: Product): number {
  return marginAt(item.listPrice, item.unitCost);
}

export function productPosition(
  floors: MarginFloor[],
  item: Product,
): MarginPosition | null {
  return marginPosition(floors, item.category, productMargin(item));
}

/** The margin a promotion would trade at once its discount applies. */
export function promotionMargin(
  item: Product | undefined,
  promotion: Promotion,
): number | null {
  if (!item) return null;
  return marginAt(
    discountedPrice(item.listPrice, promotion.discountPercent),
    item.unitCost,
  );
}

/**
 * WHETHER SOMETHING CLEARS ITS FLOOR — with `"unknown"` as a first-class answer.
 *
 * There used to be an `isBelowFloor(): boolean` here that ended `?? false`, so a
 * product whose category had no floor on file read as COMPLIANT and the KPIs
 * painted a green `0 below floor` all-clear. That is the worst failure this skin
 * has, because it is indistinguishable from good news: below-floor detection is
 * the subject of the margin ladder AND of the beat-6 gate.
 *
 * `store.floorFor` (the server) refuses to guess the same condition — it throws
 * `UNKNOWN_CATEGORY` rather than return a zeroed floor that "would make every
 * margin look healthy". This is the same stance, expressed the way a client can
 * afford: a THIRD state instead of a throw. A throw here would blank the page or
 * the canvas on a partial ledger, which trades a false all-clear for a dead
 * screen — worse in front of a room, and still not information. `"unknown"`
 * forces every consumer to say something, and the ones that publish a headline
 * figure (`belowFloorCount`) publish `null` rather than a number they cannot
 * stand behind.
 *
 * A missing floor is reachable, not theoretical: the ledger arrives over
 * `/api/commerce/v1/ledger` through an unvalidated `as CommerceStoreState` cast
 * (see `ledger-context.tsx`), the provider mounts children on a FAILED first
 * fetch with `floors: []`, `useReportData()` falls back to `floors: []` outside
 * its provider, the sandbox snapshot starts empty, and `CATEGORIES` in `types.ts`
 * and `SEED_FLOORS` in `seed.ts` are two independent lists with no drift guard.
 */
export type FloorStatus = "below" | "clear" | "unknown";

function statusFrom(position: MarginPosition | null): FloorStatus {
  if (!position) return "unknown";
  return position.belowFloor ? "below" : "clear";
}

export function productFloorStatus(
  floors: MarginFloor[],
  item: Product,
): FloorStatus {
  return statusFrom(productPosition(floors, item));
}

/** As above, for the margin a markdown would actually trade at. */
export function promotionFloorStatus(
  floors: MarginFloor[],
  item: Product | undefined,
  promotion: Promotion,
): FloorStatus {
  const margin = promotionMargin(item, promotion);
  if (!item || margin === null) return "unknown";
  return statusFrom(marginPosition(floors, item.category, margin));
}

/**
 * The wire form of a `FloorStatus` for anything the MODEL reads — a readable, a
 * sandbox DTO. `null` for unknown, never `false`: a model handed
 * `belowFloor: false` will say the SKU is fine, which is the false all-clear
 * again, one layer down.
 */
export function nullableBelowFloor(status: FloorStatus): boolean | null {
  return status === "unknown" ? null : status === "below";
}

export interface FloorTally {
  /** Trading under its category floor. */
  below: number;
  /** Clears its category floor. */
  clear: number;
  /** No floor on file for its category — checked against NOTHING, so counted
   * apart from `clear` rather than folded into it. */
  unknown: number;
}

/**
 * The tally over ANY set of floor verdicts — products, markdowns, a withheld
 * slice. Kept separate from `tallyFloorStatus` because the promotions desk
 * measures MARKDOWNS (`promotionFloorStatus`), and it must not have to re-derive
 * "how many could not be checked" with its own loop: that is precisely how a
 * green zero grew back on the Promotions page after this vocabulary landed.
 */
export function tallyStatuses(statuses: Iterable<FloorStatus>): FloorTally {
  const tally: FloorTally = { below: 0, clear: 0, unknown: 0 };
  for (const status of statuses) tally[status] += 1;
  return tally;
}

export function tallyFloorStatus(
  floors: MarginFloor[],
  products: Product[],
): FloorTally {
  return tallyStatuses(products.map((p) => productFloorStatus(floors, p)));
}

/**
 * A tally's headline "how many broke the floor" figure — `null` the moment
 * ANYTHING in the set could not be checked, because a partial count presented as
 * the count is the same lie in a smaller font. Per-row status is unaffected: a
 * violation still reports `"below"` on its own row, so nothing is lost except a
 * total nobody can defend.
 */
export function countBelow(tally: FloorTally): number | null {
  return tally.unknown > 0 ? null : tally.below;
}

/** `countBelow` over a product range — the catalog's headline SKU figure. */
export function belowFloorCount(
  floors: MarginFloor[],
  products: Product[],
): number | null {
  return countBelow(tallyFloorStatus(floors, products));
}

/**
 * Below-floor first, then anything that could NOT be checked, then the rest.
 *
 * Every worklist in this skin ranks by this — the catalog's rows and the
 * promotions desk's cards — because they are the same claim about the same
 * question: an UNCHECKED row is not a clean one, so it may not sink below the
 * rows that were actually cleared. Shared rather than written per page so the two
 * cannot disagree about where an unmeasurable row belongs.
 */
export const FLOOR_WORKLIST_RANK: Record<FloorStatus, number> = {
  below: 0,
  unknown: 1,
  clear: 2,
};

/**
 * The caveat every below-floor readout owes when the set was not fully
 * checkable. `null` when there is nothing to caveat, so a caller can render it
 * unconditionally.
 *
 * The noun is a parameter because the same sentence is owed by two different
 * desks — the catalog counts SKUs, the promotions desk counts markdowns — and a
 * caveat that names the wrong thing invites the reader to look for it in the
 * wrong place.
 */
export function noFloorCaveat(
  unknown: number,
  noun: { one: string; many: string } = { one: "SKU", many: "SKUs" },
): string | null {
  if (unknown <= 0) return null;
  return unknown === 1
    ? `1 ${noun.one} has no category margin floor on file and was not checked`
    : `${unknown} ${noun.many} have no category margin floor on file and were not checked`;
}

/** The markdown-flavoured `noFloorCaveat`, so no caller spells the noun twice. */
export function noMarkdownFloorCaveat(unknown: number): string | null {
  return noFloorCaveat(unknown, { one: "markdown", many: "markdowns" });
}

/**
 * Whole days since an ISO timestamp. Never negative.
 *
 * INSTANT-based, deliberately — unlike `daysUntil` below. `placedAt`,
 * `requestedAt` and `submittedAt` are full timestamps (`store.daysAgoIso`), and
 * "how long has this order been sitting" is elapsed time rather than a calendar
 * difference: an order placed 30 hours ago is one day old however many midnights
 * happened in between. Both operands are instants here, so the comparison is
 * already like-with-like and nothing about it drifts with the time of day.
 */
export function ageInDays(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS),
  );
}

/**
 * The UTC calendar day an instant falls on, as a whole-day index off the epoch.
 *
 * The epoch is itself midnight UTC, so flooring an instant by the day gives the
 * UTC day number directly, and a date-only `YYYY-MM-DD` string — which
 * `new Date()` parses as midnight UTC — lands exactly on its own index.
 */
function utcDayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * Signed whole CALENDAR DAYS from today until a date-only `YYYY-MM-DD` value:
 * `0` today, `1` tomorrow, negative once the date is past.
 *
 * DAY-based, not instant-based, and that is the whole point. A date-only value
 * denotes a day rather than a moment, so subtracting it from `Date.now()` — a
 * full timestamp — and rounding compares two different kinds of thing, and the
 * answer then moves with the wall clock. That is exactly what this used to do:
 * a promotion ending TODAY parses as today 00:00 UTC, so from 12:00:00 UTC
 * onward the difference passed −0.5 days, rounded to −1, and the promotions page
 * read "ended yesterday" ON THE DAY IT ENDS. Every other window label wobbled
 * ±1 through the same day. The seed hid it (no seeded window ends today) and it
 * only reproduced in the afternoon, which is the worst pair of properties a bug
 * can have on a demo screen.
 *
 * The frame is **UTC**, chosen to match the writer: `store.daysFromNowDate`
 * mints these strings with `.toISOString().slice(0, 10)`, which is the UTC day.
 * Reading them back in local time would mean a seed written "0 days from now"
 * could parse as yesterday or tomorrow west or east of Greenwich. One frame at
 * both ends is what makes the round trip exact.
 */
export function daysUntil(isoDate: string): number {
  return utcDayIndex(new Date(isoDate).getTime()) - utcDayIndex(Date.now());
}

/** "starts in 6 days", "ends today", "ended 7 days ago" — a promotion window. */
export function windowLabel(startsAt: string, endsAt: string): string {
  const start = daysUntil(startsAt);
  const end = daysUntil(endsAt);
  if (end < 0) return end === -1 ? "ended yesterday" : `ended ${-end} days ago`;
  if (start > 0)
    return start === 1 ? "starts tomorrow" : `starts in ${start} days`;
  // "ends today" outranks "starts today" so a ONE-DAY window says the urgent
  // half. Testing `start === 0` first (as this did) meant a promotion that
  // opens and closes today announced only that it had opened — the last thing a
  // merchandiser needs to know about it is that today is the last chance.
  if (end === 0) return "ends today";
  if (start === 0) return "starts today";
  return `live, ends in ${end} days`;
}

/** Weeks of cover at the trailing-30 run rate. `null` when nothing is selling. */
export function weeksOfCover(item: Product): number | null {
  if (item.trailing30Units <= 0) return null;
  const weeklyRate = item.trailing30Units / 4.33;
  return Math.round((item.inventory / weeklyRate) * 10) / 10;
}

/**
 * THE exception queue, as ONE predicate.
 *
 * An order is in the queue when it still carries an exception AND has not been
 * cancelled. The `status` clause is load-bearing, not defensive: `setOrderStatus`
 * moves an order to `cancelled` WITHOUT clearing the exception it was carrying,
 * and `PATCH /api/commerce/v1/orders/[id]` accepts that status, so a
 * cancelled-with-exception row is reachable in a live demo. A cancelled order
 * needs no decision, so it is not work in the queue and its value is not at risk.
 *
 * Every count, money figure and list of "orders on exception" MUST come through
 * here: the Orders KPI row, the a2ui brief's StatCard and TradingList, and the
 * OGUI sandbox functions. Those render SIDE BY SIDE — a generated panel sits on
 * the canvas next to the app's own cards, off the same ledger — so a hand-copied
 * clause that drops half the predicate puts two different answers to one question
 * on screen at the same time. That is exactly what shipped: `getOrders`'
 * `exceptionsOnly` filter tested `exception !== "none"` alone, so a generated
 * panel listed a longer queue than the card beside it.
 *
 * NOT the same thing as the Orders page's `exception=any` LEVER, which tests
 * `exception !== "none"` on its own because it composes with a SEPARATE status
 * lever the user drives explicitly (`pages/orders.tsx`'s `visible` useMemo).
 */
export function isOnException(
  order: Pick<Order, "status" | "exception">,
): boolean {
  return order.exception !== "none" && order.status !== "cancelled";
}

/** The exception queue itself. Input order is preserved; sort at the call site. */
export function ordersOnException<
  T extends Pick<Order, "status" | "exception">,
>(orders: readonly T[]): T[] {
  return orders.filter(isOnException);
}

/**
 * The money sitting in the exception queue.
 *
 * Takes the FULL order book rather than a pre-filtered list, so the figure and
 * the count it is shown next to can never be derived from two different sets.
 */
export function valueAtRisk(
  orders: readonly Pick<Order, "status" | "exception" | "total">[],
): number {
  return ordersOnException(orders).reduce((sum, order) => sum + order.total, 0);
}

/**
 * An OPEN return — one the desk still has to touch.
 *
 * Both `refunded` and `declined` are FINISHED states: a declined return has had
 * its decision and will never be refunded. The Returns page has always drawn the
 * line there (`pages/returns.tsx`), while the sandbox's `openReturns` KPI counted
 * declined rows as open — so a generated panel reported more outstanding work
 * than the page it sat beside. Same defect class as `isOnException` above, same
 * fix: one predicate, no hand-copies.
 */
export function isOpenReturn(request: Pick<ReturnRequest, "status">): boolean {
  return request.status !== "refunded" && request.status !== "declined";
}

/** The open returns themselves. Input order is preserved. */
export function openReturns<T extends Pick<ReturnRequest, "status">>(
  requests: readonly T[],
): T[] {
  return requests.filter(isOpenReturn);
}

/**
 * The exception filter values the Orders page renders as controls, BUILT from
 * `ORDER_EXCEPTIONS` rather than hand-copied.
 *
 * `all` and `any` are filter-only ideas — "any" means every order still carrying
 * an exception, which is the beat-3c lever. `none` is dropped because "orders
 * with no exception" is what `all` minus `any` already expresses, and a control
 * for it would read as a third synonym for the same thing.
 *
 * Every remaining value MUST have a control. `showOrderQueue`'s schema is BUILT
 * from this list (`z.enum(EXCEPTION_FILTERS)`, no longer a hand-copy of it), and
 * a value the agent can set but the page cannot show breaks
 * beat 3c in the way that is hardest to notice: the rows filter correctly and no
 * control lights up. Deriving the list is what makes that impossible rather than
 * merely fixed once — `derive.test.ts` pins it.
 */
export const EXCEPTION_FILTERS = [
  "all",
  "any",
  ...ORDER_EXCEPTIONS.filter((e) => e !== "none"),
] as const;

export type ExceptionFilter = (typeof EXCEPTION_FILTERS)[number];

/** Why an order can be HELD — every exception except the happy path. */
export type HoldReason = Exclude<OrderException, "none">;

/**
 * The reasons `holdOrder` may be called with, BUILT from `ORDER_EXCEPTIONS` for
 * the same reason `EXCEPTION_FILTERS` above is and `notifyCustomer`'s template
 * enum is: one vocabulary, not two that drift. The tool used to repeat these five
 * strings as a hand-written `z.enum([...])`, so an exception added to the store —
 * and therefore filterable on the Orders page, labelled by
 * `ORDER_EXCEPTION_LABEL` and reachable by `showOrderQueue` — would be the one
 * exception the agent could not actually put an order INTO.
 *
 * `none` is dropped because holding an order for no exception is not a state the
 * ledger has: `isOnException` reads `none` as "not queue work", so a hold filed
 * under it would write a held order that no queue view shows.
 *
 * Taken as the TAIL of `ORDER_EXCEPTIONS`, which lists the happy path first,
 * rather than by `.filter()`: `z.enum()` only accepts a non-empty TUPLE, and
 * `filter` erases the tuple shape (a cast back to one is not even sound — an
 * empty array satisfies the array type). Destructuring keeps it, and there is no
 * assertion anywhere in the chain. Should `none` ever move or another value be
 * added ahead of it, `derive.test.ts`'s membership pin fails.
 */
const [, ...HOLD_REASON_TAIL] = ORDER_EXCEPTIONS;

export const HOLD_REASONS: readonly [HoldReason, ...HoldReason[]] =
  HOLD_REASON_TAIL;

/**
 * The status filter values the Orders page renders as controls, BUILT from
 * `ORDER_STATUSES` for exactly the reason `EXCEPTION_FILTERS` above is built
 * from `ORDER_EXCEPTIONS`: `showOrderQueue`'s schema advertises this same list,
 * and a status the agent can set that the page has no control for is beat 3c
 * failing silently.
 *
 * `cancelled` is on the list and is honoured END TO END, which is a deliberate
 * position and not an oversight: the page draws the control, its `visible` list
 * renders those rows, the page readable describes them, and the sandbox's
 * `getOrders` returns them. Only the skin's global ledger readable used to hide
 * them, which made `cancelled` the one status the agent could ask for and then
 * could not talk about — and, once it had navigated, put a page readable listing
 * rows against a ledger readable claiming they did not exist.
 *
 * What a cancelled order is NOT is queue work. That distinction belongs to
 * `isOnException` alone (see its header); it is never re-expressed as an
 * order-book filter.
 */
export const ORDER_STATUS_FILTERS = ["all", ...ORDER_STATUSES] as const;

export type StatusFilter = (typeof ORDER_STATUS_FILTERS)[number];

/**
 * The sort orders the Orders page can apply, and therefore the only ones
 * `showOrderQueue` may advertise. The page types its comparator table as
 * `Record<OrderSort, …>` and the lever card types its chip labels the same way,
 * so a sort with no comparator — or a comparator with no chip label — does not
 * compile.
 */
export const ORDER_SORTS = ["aging_desc", "aging_asc", "value_desc"] as const;

export type OrderSort = (typeof ORDER_SORTS)[number];

export const ORDER_EXCEPTION_LABEL: Record<OrderException, string> = {
  none: "Clear",
  "fraud-review": "Fraud review",
  "address-invalid": "Address invalid",
  oversell: "Oversell",
  "carrier-delay": "Carrier delay",
  "payment-declined": "Payment declined",
};

export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  sizing: "Sizing",
  damaged: "Damaged",
  "not-as-described": "Not as described",
  "changed-mind": "Changed mind",
  "late-delivery": "Late delivery",
};

export const CHANNEL_LABEL: Record<Order["channel"], string> = {
  web: "Web",
  retail: "Retail",
  wholesale: "Wholesale",
  marketplace: "Marketplace",
};

/** The units on an order — shown alongside the value on every row. */
export function orderUnits(order: Order): number {
  return order.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * A stable hue per SKU or customer, derived from the string.
 *
 * Bellwether puts a small tile on nearly every row, and random colours would
 * make the catalog read as confetti while identical colours would make it read
 * as a spreadsheet. A deterministic hash gives each product a colour it KEEPS —
 * across pages, across reloads, and inside chat gen-UI — so a SKU becomes
 * recognisable at a glance. The range is applied at low saturation (see
 * `SkuTile`) so the ink-blue chrome stays the loudest thing on screen.
 */
export function tileHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360;
  }
  return hash;
}
