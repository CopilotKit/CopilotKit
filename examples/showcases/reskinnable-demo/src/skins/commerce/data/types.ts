/**
 * Bellwether's domain model. Server-safe (plain types + string unions, no React)
 * so `store.ts`, the REST routes and the agent-side modules can all import it.
 */

/**
 * The merchandising categories, as a const tuple with the union derived from it —
 * the same shape as `ORDER_EXCEPTIONS` and `NOTIFICATION_TEMPLATES` below, for
 * the same reason plus one more.
 *
 * The extra reason: a tuple is what `z.enum()` accepts. A category parameter the
 * MODEL fills — `getProducts` in `sandbox-functions.ts`, `showMarginLadder` in
 * `tools.tsx` — must advertise this exact vocabulary and refuse anything else,
 * because a near-miss ("Shoes", "footwear") silently filters to nothing and the
 * generated view renders convincingly blank. With the list only available as
 * `readonly Category[]` the schema could not be an enum, so it was `z.string()`
 * and the vocabulary never reached the model at all.
 */
export const CATEGORIES = [
  "Outerwear",
  "Knitwear",
  "Footwear",
  "Accessories",
  "Home",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * The minimum gross margin merchandising will trade a category at. `floor` is
 * the hard edge the BELOW_MARGIN_FLOOR gate is enforced against (see
 * store.promotionApprovalBlocker); `target` is what the category is planned to
 * earn and is what the ladder renders its target tick at.
 */
export interface MarginFloor {
  category: Category;
  /** Gross margin as a ratio, e.g. 0.42 for 42%. */
  floor: number;
  /** The planned margin for the category. Always above `floor`. */
  target: number;
}

export type ProductStatus = "live" | "backorder" | "discontinued";

export interface Product {
  id: string;
  /** The merchandising SKU code shown on every row, e.g. "BW-CDR-HDY". */
  sku: string;
  name: string;
  category: Category;
  /** Full retail price in whole dollars. */
  listPrice: number;
  /** Landed unit cost in whole dollars. Drives every margin figure. */
  unitCost: number;
  /** Units on hand across all locations. */
  inventory: number;
  /** Units sold in the trailing 30 days — the velocity signal on the catalog. */
  trailing30Units: number;
  status: ProductStatus;
  vendor: string;
}

/**
 * An order's lifecycle state, declared as a const tuple for the same reason
 * `ORDER_EXCEPTIONS` below is: the Orders page's status controls and the
 * `showOrderQueue` lever schema are BUILT from this list
 * (`ORDER_STATUS_FILTERS` in `derive.ts`) rather than repeating it, so a status
 * the agent can ask for and the page has no control for cannot exist.
 *
 * Listed in the order the page draws the controls in.
 */
export const ORDER_STATUSES = [
  "open",
  "on-hold",
  "fulfilled",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Why an order needs a human. `"none"` is the happy path; everything else puts
 * the order in the exception queue that the Orders page is built around.
 *
 * Declared as a const tuple and the union derived from it, so the Orders page's
 * filter controls can be BUILT from this list rather than repeating it. Beat 3c
 * turns on every value the agent can set having a control that lights up when it
 * does; a hand-copied subset silently filtered the rows with nothing on screen
 * crediting the assistant. See `EXCEPTION_FILTERS` in `derive.ts`.
 */
export const ORDER_EXCEPTIONS = [
  "none",
  "fraud-review",
  "address-invalid",
  "oversell",
  "carrier-delay",
  "payment-declined",
] as const;

export type OrderException = (typeof ORDER_EXCEPTIONS)[number];

export interface OrderNote {
  id: string;
  text: string;
  author: string;
  createdAt: string;
}

/**
 * The messages Bellwether will actually send a customer. A CLOSED set, declared
 * here rather than only in the `notifyCustomer` tool's zod enum, because the
 * route is what persists the record and the store is what the Orders page and
 * the beat-3b readable read back. The tool's enum is built FROM this list
 * (`src/skins/commerce/tools.tsx`) so there is one vocabulary, not two that
 * drift: a template that only the wire accepts would be rendered raw on the page
 * and narrated by the agent as though it were app state.
 */
export const NOTIFICATION_TEMPLATES = [
  "verification-required",
  "address-confirmation",
  "delay-apology",
  "restock-eta",
] as const;

export type NotificationTemplate = (typeof NOTIFICATION_TEMPLATES)[number];

export function isNotificationTemplate(
  value: unknown,
): value is NotificationTemplate {
  return (NOTIFICATION_TEMPLATES as readonly unknown[]).includes(value);
}

/** A customer notification the app has actually sent — beat 5's second write. */
export interface OrderNotification {
  id: string;
  orderId: string;
  template: NotificationTemplate;
  sentAt: string;
  sentBy: string;
}

export interface OrderLine {
  productId: string;
  quantity: number;
  /** Unit price actually charged, after any promotion. */
  unitPrice: number;
}

export interface Order {
  id: string;
  /** The human-facing order number, e.g. "4471". */
  number: string;
  customerName: string;
  customerEmail: string;
  channel: "web" | "retail" | "wholesale" | "marketplace";
  destination: string;
  /** ISO timestamp, materialized from the seed's relative offset at store init. */
  placedAt: string;
  status: OrderStatus;
  exception: OrderException;
  lines: OrderLine[];
  /** Order total in whole dollars. */
  total: number;
  notes: OrderNote[];
}

export type ReturnReason =
  | "sizing"
  | "damaged"
  | "not-as-described"
  | "changed-mind"
  | "late-delivery";

export type ReturnStatus = "requested" | "approved" | "refunded" | "declined";

/**
 * BEAT 3a — the refundable object. The goodwill figure is typed by the merchant
 * into a card in the chat and goes straight to REST; it is never a tool argument
 * the model authored, and it never appears in a tool result.
 */
export interface ReturnRequest {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  productId: string;
  reason: ReturnReason;
  detail: string;
  requestedAt: string;
  status: ReturnStatus;
  /** What the item was originally charged at. */
  itemValue: number;
  /** Set only once a refund has actually been issued. */
  refundAmount: number | null;
}

export type PromotionStatus = "pending" | "approved" | "declined";

/**
 * BEAT 6 — the gated object. Approving one flips `status` to `"approved"` and
 * writes NOTHING onto the product (`approvePromotion` in `store.ts`; it returns
 * the joined product only so the route can echo it). There is no live-markdown
 * field to write, and that is deliberate: the markdown price and the margin it
 * would trade at are DERIVED from `listPrice` + `discountPercent` wherever a
 * promotion is shown (`discountedPrice` / `promotionMargin` in `derive.ts`),
 * while the catalog and the margin ladder stay at LIST price by design
 * (`productMargin`). Do not "restore" a product-level discount here — it would
 * double-count against the derived figure and move the ladder.
 *
 * Approval is refused with 422 BELOW_MARGIN_FLOOR when the discounted margin
 * sits under the category's floor and no APPROVED, JUSTIFYING margin waiver is
 * on file against this promotion. The gate reads waivers by `promotionId`
 * (`hasApprovedJustifyingWaiver`), NOT the `marginWaiverId` link below, which
 * exists for display.
 */
export interface Promotion {
  id: string;
  name: string;
  productId: string;
  /** Whole percent off list, e.g. 40. */
  discountPercent: number;
  /** ISO date the markdown is meant to go live. */
  startsAt: string;
  /** ISO date it ends. */
  endsAt: string;
  submittedBy: string;
  submittedAt: string;
  status: PromotionStatus;
  /**
   * The waiver this markdown's approvability RESTS ON — null until one is
   * finalized. A justifying link is never displaced by a decoy finalized later
   * (see `creditWaiver` in `store.ts`), so this field can be read as "the code
   * that cleared the floor" whenever one exists.
   */
  marginWaiverId: string | null;
}

export type MarginWaiverStatus = "draft" | "approved";

/**
 * BEAT 6 — the unlock artifact. Filed under a code from the catalogue in
 * `waiver-codes.ts`; only a JUSTIFYING code lifts the gate once the waiver is
 * finalized.
 */
export interface MarginWaiver {
  id: string;
  promotionId: string;
  code: string;
  justification: string;
  status: MarginWaiverStatus;
  openedAt: string;
  finalizedAt: string | null;
}

/**
 * BEAT 3d — the durable artifact. Written to the STORE, not to the thread, so
 * deleting the conversation leaves it standing on the Catalog page.
 */
export interface RestockPlan {
  id: string;
  vendor: string;
  season: string;
  summary: string;
  /** At most three; `store.filePlan` truncates (the tool's schema also caps at 3). */
  highlights: string[];
  /** The SKUs the plan covers, with the landed cost the price sheet quoted. */
  lines: { sku: string; name: string; landedCost: number; units: number }[];
  /** Launch schedule, typically lifted from an uploaded price sheet. */
  schedule: { week: string; item: string }[];
  filedAt: string;
  filedBy: string;
}

/** The signed-in operator. Bellwether scopes durable memory per person id. */
export interface Operator {
  id: string;
  name: string;
  role: "merch-lead" | "ops-manager" | "buyer";
  team: "Merchandising" | "Fulfillment" | "Buying";
}

/** Everything the store holds. Cloned wholesale on reset. */
export interface CommerceStoreState {
  products: Product[];
  floors: MarginFloor[];
  orders: Order[];
  notifications: OrderNotification[];
  returns: ReturnRequest[];
  promotions: Promotion[];
  waivers: MarginWaiver[];
  plans: RestockPlan[];
  operators: Operator[];
}

/** Where a product's margin sits against its category floor — the ladder's core value. */
export interface MarginPosition {
  category: Category;
  /** Gross margin as a ratio at the price being evaluated. */
  margin: number;
  floor: number;
  target: number;
  /** 0 at the category floor, 1 at the ladder ceiling. Clamped for rendering, NOT for the gate. */
  ratio: number;
  /** True when the margin is genuinely under the floor. */
  belowFloor: boolean;
}
