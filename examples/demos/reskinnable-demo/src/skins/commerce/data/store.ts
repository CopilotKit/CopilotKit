/**
 * Bellwether's server-side ledger.
 *
 * An in-memory module, exactly like `src/skins/people/data/store.ts` and
 * `src/skins/banking/data/store.ts`: state lives for the life of the Node
 * process and `reset()` re-materializes it from the seed. Every
 * `/api/commerce/v1/*` route reads and writes through here, which is what makes
 * beat 3d true — a filed restock plan belongs to the APPLICATION, so deleting
 * the chat thread cannot take it away.
 *
 * Mutations that can legitimately be refused throw an Error whose `message` is
 * a stable CODE (`NOT_FOUND`, `BELOW_MARGIN_FLOOR`, `INVALID_WAIVER_CODE`, …).
 * The routes map those codes onto HTTP statuses; nothing parses prose.
 *
 * A DANGLING reference is a different animal and carries its own codes
 * (`DANGLING_PRODUCT_REF`, `DANGLING_PROMOTION_REF`). `NOT_FOUND` means "the
 * record you named is not here" — a caller error, and something the agent can
 * act on by naming a different record. A promotion whose `productId` resolves to
 * nothing means OUR ledger is internally inconsistent: no caller can act on it,
 * and nobody should have to guess. Both used to raise `NOT_FOUND`, so an
 * integrity failure was reported as a routine `404 "That record does not
 * exist."` with nothing logged anywhere. `data/http.ts` deliberately leaves the
 * dangling codes OUT of its code map so they take its logged-500 branch — read
 * the comment there before adding them to it.
 */

import {
  isJustifying,
  isValidWaiverCode,
  normalizeJustification,
} from "./waiver-codes";
import { isNotificationTemplate } from "./types";
import {
  DEFAULT_OPERATOR_ID,
  SEED_FLOORS,
  SEED_ORDERS,
  SEED_PLANS,
  SEED_PRODUCTS,
  SEED_PROMOTIONS,
  SEED_RETURNS,
  SEED_OPERATORS,
} from "./seed";
import type {
  Category,
  CommerceStoreState,
  MarginFloor,
  MarginPosition,
  MarginWaiver,
  Operator,
  Order,
  OrderException,
  OrderNotification,
  OrderStatus,
  Product,
  Promotion,
  RestockPlan,
  ReturnRequest,
} from "./types";

export { DEFAULT_OPERATOR_ID };

const DAY_MS = 86_400_000;

/**
 * The top of the `marginPosition` scale — the absolute margin a per-row bar
 * reads as "full". Margins above this are rare enough in this range that giving
 * them their own headroom would squash the interesting band, where the floor
 * sits, into the bottom fifth of the bar.
 *
 * NOT the top of a ladder rail: the ladder plots a floor-RELATIVE axis
 * (`derive.ladderRatio`), which is what puts every category's floor line at one
 * height. Mirrored in `derive.LADDER_CEILING`.
 */
export const LADDER_CEILING = 0.75;

/** Full ISO timestamp, n days before now. Negative n is in the future. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/** `YYYY-MM-DD`, n days from now. Negative n is in the past. */
function daysFromNowDate(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days between an ISO timestamp and now. Never negative. */
export function ageInDays(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS),
  );
}

/**
 * Turn the relative-offset seed into dated records. Called at module init and
 * again on every `reset()`, so a presenter Reset re-freshens the order aging
 * rather than restoring timestamps that were already stale.
 */
function materialize(): CommerceStoreState {
  return {
    floors: SEED_FLOORS.map((f) => ({ ...f })),
    products: SEED_PRODUCTS.map((p) => ({ ...p })),
    orders: SEED_ORDERS.map((o) => ({
      id: o.id,
      number: o.number,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      channel: o.channel,
      destination: o.destination,
      placedAt: daysAgoIso(o.placedDaysAgo),
      status: o.status,
      exception: o.exception,
      lines: o.lines.map((l) => ({ ...l })),
      total: o.total,
      notes: [],
    })),
    notifications: [],
    returns: SEED_RETURNS.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      customerName: r.customerName,
      productId: r.productId,
      reason: r.reason,
      detail: r.detail,
      requestedAt: daysAgoIso(r.requestedDaysAgo),
      status: r.status,
      itemValue: r.itemValue,
      refundAmount: r.refundAmount,
    })),
    promotions: SEED_PROMOTIONS.map((p) => ({
      id: p.id,
      name: p.name,
      productId: p.productId,
      discountPercent: p.discountPercent,
      startsAt: daysFromNowDate(p.startsInDays),
      endsAt: daysFromNowDate(p.endsInDays),
      submittedBy: p.submittedBy,
      submittedAt: daysAgoIso(p.submittedDaysAgo),
      status: p.status,
      marginWaiverId: null,
    })),
    waivers: [],
    plans: SEED_PLANS.map((p) => ({
      id: p.id,
      vendor: p.vendor,
      season: p.season,
      summary: p.summary,
      highlights: [...p.highlights],
      lines: p.lines.map((l) => ({ ...l })),
      schedule: p.schedule.map((s) => ({ ...s })),
      filedAt: daysAgoIso(p.filedDaysAgo),
      filedBy: p.filedBy,
    })),
    operators: SEED_OPERATORS.map((o) => ({ ...o })),
  };
}

let state: CommerceStoreState = materialize();

/** Monotonic suffix so generated ids are readable and stable within a run. */
let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`;
}

export function reset(): void {
  state = materialize();
  counter = 0;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export const products = (): Product[] => state.products;
export const floors = (): MarginFloor[] => state.floors;
export const orders = (): Order[] => state.orders;
export const notifications = (): OrderNotification[] => state.notifications;
export const returns = (): ReturnRequest[] => state.returns;
export const promotions = (): Promotion[] => state.promotions;
export const waivers = (): MarginWaiver[] => state.waivers;
export const plans = (): RestockPlan[] => state.plans;
export const operators = (): Operator[] => state.operators;

export function product(id: string): Product | undefined {
  return state.products.find((p) => p.id === id);
}

export function order(id: string): Order | undefined {
  // Accept the human-facing order NUMBER as well as the id. The agent resolves
  // "order 4471" from context and either spelling is a reasonable thing for it
  // to send; refusing one of them would be a routing failure dressed as a 404.
  return (
    state.orders.find((o) => o.id === id) ??
    state.orders.find((o) => o.number === id)
  );
}

export function floorFor(category: Category): MarginFloor {
  const found = state.floors.find((f) => f.category === category);
  // Every product carries a Category from the union and the seed defines a
  // floor for all five, so this is unreachable — but throwing a coded error
  // beats returning a zeroed floor that would make every margin look healthy.
  if (!found) throw new Error("UNKNOWN_CATEGORY");
  return found;
}

// ── Derived ─────────────────────────────────────────────────────────────────

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
 * Where a margin sits against its category floor. `ratio` is clamped to [0, 1]
 * because it drives the dot's position on the ladder rail; `belowFloor` is
 * computed from the RAW comparison, so clamping never hides a violation.
 * Keeping those two separate is what lets a below-floor SKU render pinned to the
 * bottom of the rail AND flagged.
 */
export function marginPosition(
  category: Category,
  margin: number,
): MarginPosition {
  const { floor, target } = floorFor(category);
  const span = LADDER_CEILING - floor;
  const raw = span === 0 ? 0.5 : (margin - floor) / span;
  return {
    category,
    margin,
    floor,
    target,
    ratio: Math.min(1, Math.max(0, raw)),
    belowFloor: margin < floor,
  };
}

export function isBelowFloor(item: Product): boolean {
  return (
    marginAt(item.listPrice, item.unitCost) < floorFor(item.category).floor
  );
}

/**
 * BEAT 6, the discriminating half. A waiver only counts when it is filed
 * against THIS promotion, has been finalized to `approved`, AND carries a
 * justifying code. A decoy code satisfies the first two and fails the third —
 * which is exactly why "the agent filed a waiver" is not the same as "the agent
 * cleared the gate".
 */
export function hasApprovedJustifyingWaiver(promotionId: string): boolean {
  return state.waivers.some(
    (w) =>
      w.promotionId === promotionId &&
      w.status === "approved" &&
      isJustifying(w.code),
  );
}

export function waiversFor(promotionId: string): MarginWaiver[] {
  return state.waivers.filter((w) => w.promotionId === promotionId);
}

/** The margin a promotion would actually trade at once its discount applies. */
export function promotionMargin(promotion: Promotion): number | null {
  const item = product(promotion.productId);
  if (!item) return null;
  return marginAt(
    discountedPrice(item.listPrice, promotion.discountPercent),
    item.unitCost,
  );
}

/** The gate, as a pure predicate. `null` = allowed; a string = the refusal code. */
export function promotionApprovalBlocker(promotion: Promotion): string | null {
  if (promotion.status !== "pending") return "ALREADY_DECIDED";
  const item = product(promotion.productId);
  // NOT a not-found: the promotion the caller named exists. A promotion pointing
  // at a product that does not is our broken invariant, so it gets a code the
  // routes turn into a logged 500 rather than a 404 the agent would "fix" by
  // retrying with a different id.
  if (!item) return "DANGLING_PRODUCT_REF";
  const margin = marginAt(
    discountedPrice(item.listPrice, promotion.discountPercent),
    item.unitCost,
  );
  if (margin >= floorFor(item.category).floor) return null;
  if (hasApprovedJustifyingWaiver(promotion.id)) return null;
  return "BELOW_MARGIN_FLOOR";
}

// ── The order state machine ─────────────────────────────────────────────────

/**
 * The statuses an order has SETTLED into. Two consequences, and both are rules
 * rather than conventions (see `orderStatusBlocker`): nothing moves OUT of one,
 * and nothing IN one may carry an exception.
 */
const SETTLED_STATUSES: readonly OrderStatus[] = ["fulfilled", "cancelled"];

const isSettled = (status: OrderStatus): boolean =>
  SETTLED_STATUSES.includes(status);

/**
 * Where an order in each status may go next — the transition table, declared
 * once, here, because this is the layer that owns the invariant. The routes and
 * the Orders page both write through `setOrderStatus`, so neither gets to hold
 * its own opinion about what is legal.
 *
 * A `Record` keyed on the union (rather than the `Map` `http.ts` needs) is the
 * right shape precisely BECAUSE the key set is closed: TypeScript then refuses
 * an incomplete table, so adding a sixth status cannot compile until someone
 * has said where it may go. Nothing untrusted is ever used as a key — the
 * lookup key is the order's OWN status, and the candidate is checked with
 * `includes`.
 *
 *  - `open` may go anywhere, including to itself: the Orders page's
 *    "clear the exception" control PATCHes `{status:"open", exception:"none"}`
 *    onto rows that are already open.
 *  - `on-hold` may return to `open` (released) or be `cancelled`, and may be
 *    re-held to restate the exception — but it may NOT jump straight to
 *    `fulfilled`. A hold exists to STOP fulfillment; shipping out of one
 *    contradicts the thing the hold did. Release it first. (Same precondition
 *    class as `issueRefund`'s "a return has to be approved before it can be
 *    refunded".)
 *  - `fulfilled` and `cancelled` are terminal, which is what makes
 *    `cancelled → open` — resurrecting a cancelled order — unrepresentable.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  open: ["open", "on-hold", "fulfilled", "cancelled"],
  "on-hold": ["on-hold", "open", "cancelled"],
  fulfilled: [],
  cancelled: [],
};

/**
 * Whether a (status, exception) PAIR is one an order may legally hold.
 *
 * The exception queue and the `valueAtRisk` KPI the demo narrates are both
 * derived from `exception !== "none"`, so a settled order that kept an
 * exception would inflate both — a shipped order counted as money still at
 * risk. Exported so the seed can be checked against the SAME rule the mutation
 * enforces (`store.test.ts`) rather than against a second copy of it.
 */
export function isLegalOrderState(
  status: OrderStatus,
  exception: OrderException,
): boolean {
  return !isSettled(status) || exception === "none";
}

/**
 * The order state machine, as a pure predicate — `null` = allowed, a string =
 * the refusal code. Mirrors `promotionApprovalBlocker`'s shape.
 *
 * `exception` is the OPTIONAL restatement a caller may send; when it is omitted
 * the order keeps the one it has, so the pair being validated is the pair the
 * order would actually end up in. That is why fulfilling an exception-bearing
 * order is refused unless the caller clears the exception in the same write:
 * settling an order is a decision about the exception too, and making it
 * explicit beats silently dropping the flag.
 */
export function orderStatusBlocker(
  current: Order,
  status: OrderStatus,
  exception?: OrderException,
): string | null {
  if (isSettled(current.status)) return "ORDER_ALREADY_SETTLED";
  if (!ORDER_TRANSITIONS[current.status].includes(status))
    return "ILLEGAL_ORDER_TRANSITION";
  if (!isLegalOrderState(status, exception ?? current.exception))
    return "EXCEPTION_ON_SETTLED_ORDER";
  return null;
}

// ── Mutations ───────────────────────────────────────────────────────────────

/** BEAT 5, step 1. Puts an order on hold and records why. */
export function setOrderStatus(
  id: string,
  status: OrderStatus,
  exception?: OrderException,
): Order {
  const target = order(id);
  if (!target) throw new Error("NOT_FOUND");
  const blocker = orderStatusBlocker(target, status, exception);
  if (blocker) throw new Error(blocker);
  target.status = status;
  if (exception) target.exception = exception;
  return target;
}

/**
 * Set an order's exception and NOTHING else — deliberately status-free.
 *
 * The Orders page's "Clear the exception" button used to PATCH
 * `{ status: "open", exception: "none" }`, so clearing the exception on an order
 * beat 5 had just put on hold silently RELEASED the hold as well: the first of
 * the stored procedure's three writes disappeared while the control claimed only
 * to have cleared a flag. A mutation that names one field cannot do that, which
 * is why the status-free path exists at this layer rather than as a
 * read-modify-write in the caller (which would race, and would have to re-assert
 * a status it never meant to touch).
 *
 * Needs no state-machine precondition when CLEARING: `"none"` is the one
 * exception value every status may legally hold, so clearing can only ever move
 * an order TOWARDS a legal pair, never into an illegal one. SETTING one does
 * need it — see below.
 */
export function setOrderException(
  id: string,
  exception: OrderException,
): Order {
  const target = order(id);
  if (!target) throw new Error("NOT_FOUND");
  // Same already-settled class the status writer refuses, by the one path that
  // does not consult the state machine: pinning a live exception onto a fulfilled
  // or cancelled order puts a settled row back into the exception queue and back
  // into the `valueAtRisk` KPI the room is asked to read as money still at risk.
  // Single-sourced through `isLegalOrderState`, so this path and
  // `orderStatusBlocker` cannot drift apart, and so clearing stays legal on every
  // status.
  if (!isLegalOrderState(target.status, exception))
    throw new Error("EXCEPTION_ON_SETTLED_ORDER");
  target.exception = exception;
  return target;
}

/**
 * Bounds on the free text beat 5's writes accept.
 *
 * These are not cosmetic. A note's text and a notification's template are BOTH
 * rendered on the Orders page and BOTH fed to the beat-3b on-screen readable
 * (`latestNote` and `recentNotifications[].template` in `pages/orders.tsx`), so
 * whatever lands in the record is read back to the model as app state. An
 * unbounded field lets a caller push an essay — or something shaped like
 * instructions — through a durable record and into the next prompt. Refusing at
 * the store means every writer is bounded, not just the route that exists today.
 *
 * The values are sized for what the demo actually sends: an operator's display
 * name, and the one-sentence note the `postOrderNote` tool asks the model for.
 */
export const MAX_ACTOR_NAME = 80;
export const MAX_NOTE_TEXT = 280;

/** BEAT 5, step 3. The 🚨 prefix is forced by the tool, not by this layer. */
export function addOrderNote(id: string, text: string, author: string): Order {
  const target = order(id);
  if (!target) throw new Error("NOT_FOUND");
  if (text.length > MAX_NOTE_TEXT) throw new Error("NOTE_TOO_LONG");
  if (author.length > MAX_ACTOR_NAME) throw new Error("ACTOR_NAME_TOO_LONG");
  target.notes.unshift({
    id: nextId("note"),
    text,
    author,
    createdAt: new Date().toISOString(),
  });
  return target;
}

/**
 * BEAT 5, step 2. A real, listed record — not a console log dressed as one.
 *
 * `template` is typed `string` because it arrives off the wire, and is narrowed
 * here against `NOTIFICATION_TEMPLATES` rather than trusted: the four templates
 * are a closed set, and an off-vocabulary value would be persisted, rendered raw
 * on the Orders page and handed to the beat-3b readable for the agent to narrate.
 */
export function notifyCustomer(
  id: string,
  template: string,
  sentBy: string,
): OrderNotification {
  const target = order(id);
  if (!target) throw new Error("NOT_FOUND");
  if (!isNotificationTemplate(template)) throw new Error("UNKNOWN_TEMPLATE");
  if (sentBy.length > MAX_ACTOR_NAME) throw new Error("ACTOR_NAME_TOO_LONG");
  const notification: OrderNotification = {
    id: nextId("ntf"),
    orderId: target.id,
    template,
    sentAt: new Date().toISOString(),
    sentBy,
  };
  state.notifications.unshift(notification);
  return notification;
}

/**
 * BEAT 3a. The figure arrives here straight from the chat card the merchant
 * typed it into; it is never in a prompt, a tool argument the model authored,
 * or a transcript. The caller gets back the return record WITHOUT the amount
 * echoed into any agent-visible string — see the route and the tool.
 */
export function issueRefund(id: string, amount: number): ReturnRequest {
  const target = state.returns.find((r) => r.id === id);
  if (!target) throw new Error("NOT_FOUND");
  if (target.status === "refunded") throw new Error("ALREADY_REFUNDED");
  // A refund SETTLES the return terminally, so the decision has to exist
  // first: `requested` was never approved and `declined` was refused outright.
  // The Returns page only offers the control on an approved row; this is that
  // same rule where the invariant actually lives, which matters because the
  // agent's return finder matches on a fuzzy substring — a loose phrase can
  // land on a row nobody decided.
  if (target.status !== "approved") throw new Error("RETURN_NOT_APPROVED");
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("INVALID_AMOUNT");
  // A refund above what was charged is a data-entry slip, not a policy call —
  // refuse it here rather than letting it quietly distort the margin figures
  // the whole app is about.
  if (amount > target.itemValue) throw new Error("REFUND_EXCEEDS_VALUE");
  target.refundAmount = Math.round(amount * 100) / 100;
  target.status = "refunded";
  return target;
}

export function decideReturn(
  id: string,
  status: "approved" | "declined",
): ReturnRequest {
  const target = state.returns.find((r) => r.id === id);
  if (!target) throw new Error("NOT_FOUND");
  if (target.status === "refunded") throw new Error("ALREADY_REFUNDED");
  // Same precondition class as `declinePromotion`: a decision only applies to a
  // return still awaiting one. Without it a `declined` return could be flipped
  // to `approved` and then refunded, which would launder the refusal the guard
  // in `issueRefund` exists to respect. The refunded case above is kept ahead of
  // this so a settled return still reports the more specific code.
  if (target.status !== "requested") throw new Error("ALREADY_DECIDED");
  target.status = status;
  return target;
}

/** BEAT 3d. The durable artifact. */
export function filePlan(input: {
  vendor: string;
  season: string;
  summary: string;
  highlights: string[];
  lines: { sku: string; name: string; landedCost: number; units: number }[];
  schedule: { week: string; item: string }[];
  filedBy: string;
}): RestockPlan {
  const plan: RestockPlan = {
    id: nextId("pln"),
    vendor: input.vendor,
    season: input.season,
    summary: input.summary,
    highlights: input.highlights.slice(0, 3),
    lines: input.lines.slice(0, 8),
    schedule: input.schedule.slice(0, 8),
    filedAt: new Date().toISOString(),
    filedBy: input.filedBy,
  };
  state.plans.unshift(plan);
  return plan;
}

// ── BEAT 6: the unlock ──────────────────────────────────────────────────────

export function openMarginWaiver(
  promotionId: string,
  code: string,
  /**
   * `unknown`, not `string`: this is a model-authored value straight off a JSON
   * body, and `normalizeJustification` is the only thing that decides whether it
   * is a justification at all. Declaring it `string` invited the caller to
   * `String()`-coerce first, which turns `{}` into 15 passing characters.
   */
  justification: unknown,
): MarginWaiver {
  const promotion = state.promotions.find((p) => p.id === promotionId);
  if (!promotion) throw new Error("NOT_FOUND");
  // Same precondition class as `declinePromotion` and `decideReturn`, and the
  // same code: a waiver justifies a decision that is still to be made. BOTH
  // decided states are refused, for two different reasons.
  //
  //  - APPROVED: the waiver is retro-justification. It would finalize, and
  //    `creditWaiver` would write its id onto the promotion — so the Promotions
  //    page (and the trade brief the room is reading) names a code as the reason
  //    the markdown became approvable when nobody consulted it. The record gets
  //    rewritten after the fact, which is worse than the filing being pointless.
  //  - DECLINED: inert by construction. `declined` is terminal — nothing returns
  //    a promotion to `pending` — so the waiver can never lift anything, and only
  //    adds a row to the `waiversFor` history the page renders.
  //
  // Checked before the code and the justification so a decided markdown gets an
  // answer about the RECORD rather than one about its paperwork, which would
  // invite a retry under a different code. It leaks nothing either way: the
  // refusal is the same whatever code was sent.
  if (promotion.status !== "pending") throw new Error("ALREADY_DECIDED");
  // Rejected WITHOUT enumerating the catalogue — listing the valid codes here
  // would hand the agent the recipe in one round-trip and beat 6 would stop
  // proving that it learned anything.
  if (!isValidWaiverCode(code)) throw new Error("INVALID_WAIVER_CODE");
  // A justifying code with no written justification is not paperwork, and it
  // must not lift the floor. Length bounds only — this refusal says nothing
  // about WHICH codes justify, so it cannot leak beat 6's recipe.
  const text = normalizeJustification(justification);
  if (text === null) throw new Error("INVALID_JUSTIFICATION");
  const waiver: MarginWaiver = {
    id: nextId("wvr"),
    promotionId,
    code,
    justification: text,
    status: "draft",
    openedAt: new Date().toISOString(),
    finalizedAt: null,
  };
  state.waivers.push(waiver);
  return waiver;
}

/**
 * `promotion.marginWaiverId` names the waiver the markdown's approvability RESTS
 * ON — not whichever waiver was finalized most recently. The distinction only
 * shows up once a promotion carries more than one waiver, and then it is the
 * whole point of beat 6: a JUSTIFYING waiver is what cleared the gate, so a
 * DECOY finalized afterwards must never displace it, or the record (and the
 * artifact the audience is reading) credits the code that proves nothing.
 *
 * So: a justifying link is permanent, and everything else fills the slot. A
 * decoy still gets linked when it is the only waiver on file — a lone decoy is
 * honestly the one thing the desk did, and `hasApprovedJustifyingWaiver`, not
 * this field, is what decides whether the gate lifts.
 */
function creditWaiver(promotion: Promotion, waiver: MarginWaiver): void {
  const credited = state.waivers.find((w) => w.id === promotion.marginWaiverId);
  if (credited && isJustifying(credited.code)) return;
  promotion.marginWaiverId = waiver.id;
}

export function finalizeMarginWaiver(id: string): MarginWaiver {
  const waiver = state.waivers.find((w) => w.id === id);
  if (!waiver) throw new Error("NOT_FOUND");
  if (waiver.status === "approved") throw new Error("ALREADY_FINALIZED");
  // The same dangling-reference class as `approvePromotion`, resolved BEFORE
  // anything is written so a corrupted ledger cannot leave a half-finalized
  // waiver behind. Every waiver took its `promotionId` from a promotion
  // `openMarginWaiver` had already resolved, and promotions are never deleted, so
  // a miss here is our bug. This used to be `if (promotion)`: the waiver
  // finalized, the route answered 200, and the link was dropped in silence —
  // the one outcome worse than reporting the wrong code.
  const promotion = state.promotions.find((p) => p.id === waiver.promotionId);
  if (!promotion) throw new Error("DANGLING_PROMOTION_REF");
  // The other half of `openMarginWaiver`'s precondition, and the reason that one
  // cannot carry it alone: a draft opened legitimately WHILE the markdown was
  // pending can still be finalized after it was approved or declined, and
  // `creditWaiver` below would then write the link onto a decided record — the
  // "attaches itself after the fact" case, reached without ever filing against a
  // decided promotion. Resolved here, before any write, so a refusal leaves no
  // half-finalized waiver behind (same discipline as the dangling check above).
  if (promotion.status !== "pending") throw new Error("ALREADY_DECIDED");
  waiver.status = "approved";
  waiver.finalizedAt = new Date().toISOString();
  // Link it for display. A DECOY waiver is genuinely on file and is still
  // linked when nothing better is credited — but it must never DISPLACE a
  // justifying one, or the page would name a non-justifying code as the reason
  // the markdown became approvable. `creditWaiver` owns that rule; only
  // `hasApprovedJustifyingWaiver` decides whether the gate actually lifts.
  //
  // `promotion` is resolved above, before any write, so the dangling-reference
  // case throws instead of silently dropping the link.
  creditWaiver(promotion, waiver);
  return waiver;
}

/**
 * BEAT 6, the gate itself. Throws `BELOW_MARGIN_FLOOR` — a SYMPTOM-ONLY code.
 * Neither this nor the route's message may ever mention margin waivers; naming
 * the fix in the error is the single easiest way to destroy this beat.
 */
export function approvePromotion(id: string): {
  promotion: Promotion;
  product: Product;
} {
  const promotion = state.promotions.find((p) => p.id === id);
  if (!promotion) throw new Error("NOT_FOUND");
  const blocker = promotionApprovalBlocker(promotion);
  if (blocker) throw new Error(blocker);

  const item = product(promotion.productId);
  // Unreachable through the blocker above, which already reports this exact
  // state as `DANGLING_PRODUCT_REF`; kept because `product()` is
  // `Product | undefined` and this function promises a `Product`. It raises the
  // same integrity code, never the plain `NOT_FOUND` it used to.
  if (!item) throw new Error("DANGLING_PRODUCT_REF");
  promotion.status = "approved";
  return { promotion, product: item };
}

export function declinePromotion(id: string): Promotion {
  const promotion = state.promotions.find((p) => p.id === id);
  if (!promotion) throw new Error("NOT_FOUND");
  if (promotion.status !== "pending") throw new Error("ALREADY_DECIDED");
  promotion.status = "declined";
  return promotion;
}

/** The whole ledger, for the client's single-fetch hook. */
export function snapshot(): CommerceStoreState {
  return state;
}
