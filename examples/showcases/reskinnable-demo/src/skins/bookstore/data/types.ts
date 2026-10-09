/**
 * The bookstore skin's data shapes. Money is ALWAYS integer cents — only
 * `formatUsd` (query.ts) turns cents into a string. Floats are banned so a
 * total can never drift by a rounding error mid-demo.
 */

export type Genre =
  | "literary"
  | "translated"
  | "scifi"
  | "mystery"
  | "history"
  | "poetry";

export type Format = "paperback" | "hardcover" | "ebook";

export type SortKey = "price_asc" | "price_desc" | "rating_desc" | "newest";

export interface Book {
  id: string; // "bk-014"
  slug: string; // "the-employees" — the URL segment for /bookstore/book/<slug>
  /**
   * Groups editions of the SAME work. Set only where a work exists in more than
   * one format — currently just the club pick, whose hardcover and paperback are
   * what `swapEdition` moves between. Absent on every other book, so nothing
   * else has to care.
   */
  workId?: string;
  title: string;
  author: string;
  /** Present on translated titles. Maya's seeded memory asks for it by name. */
  translator?: string;
  genre: Genre;
  format: Format;
  priceCents: number;
  pages: number;
  rating: number; // 0–5, one decimal
  published: string; // "2020"
  blurb: string; // one sentence
  /** Index into the six-stop cover tint ramp. 0–5. */
  spineTint: number;
  /**
   * Curated "New & Notable" flag — deliberately NOT derived from `published`.
   * See the plan's "deliberate deviations": pill 1 needs three translated
   * titles, and the year yields two.
   */
  isNew: boolean;
}

export interface CartLine {
  bookId: string;
  qty: number;
}

export interface Reminder {
  readonly bookId: string;
  readonly isoDate: string;
}

/**
 * What every agent-reachable STORE write returns. Never a throw: a write
 * reachable from the agent must be able to fail narratably (a sentence the
 * tool can hand back) rather than crash the page mid-demo.
 */
export interface WriteResult {
  ok: boolean;
  reason?: string;
}

export interface Order {
  id: string; // "1042"
  placedAt: string; // ISO
  lines: CartLine[];
  totalCents: number;
  /** The ONLY card data that ever leaves CheckoutCard. Never the full number. */
  last4: string;
}

export interface BookQuery {
  genre?: Genre;
  format?: Format;
  maxCents?: number;
  sort?: SortKey;
}

/** What `useSkinData<BookstoreData>()` returns. */
export interface BookstoreData {
  books: readonly Book[];
  cart: CartLine[];
  orders: Order[];
  addToCart: (bookId: string, qty?: number) => void;
  removeFromCart: (bookId: string) => void;
  /** Returns the order it created, so a caller can name it in one breath. */
  placeOrder: (last4: string) => Order;
  /** Drives the ~2s add-to-cart highlight. Cleared by the store, not by callers. */
  lastAddedId: string | null;
  /**
   * Churn guard for the agent-context readables: a string keyed only on cart
   * and order identity — plus anything else that changes the PRICE or the
   * agent-visible cart (`promoCode`, `deliverBy`, `storeCreditCents`) — never
   * on timers, so readables do not re-register on every highlight tick.
   * Deliberately excludes `wishlist`/`reminders`: neither affects price or
   * what the cart readable already reports, so a wishlist/reminder write
   * must not force the cart readable to re-register.
   */
  cartSignature: string;
  /** The club's code once applied, else `null`. Canonical casing, never the
   * shopper's/agent's input casing. Affects price via `cartTotals`'s `pricing`. */
  promoCode: string | null;
  /** `YYYY-MM-DD` the order must arrive by, else `null`. Does not affect price. */
  deliverBy: string | null;
  /** Store credit in integer cents, applied on top of any promo discount. */
  storeCreditCents: number;
  /** Book ids saved for later. Distinct from the cart; never affects price. */
  wishlist: readonly string[];
  /** Per-book reminders. Distinct from `deliverBy`; never affects price. */
  reminders: readonly Reminder[];
  /**
   * Replaces a cart line with another EDITION of the same work (same
   * `workId`), preserving quantity. Refuses across works, an unknown id, or a
   * `fromBookId` not currently in the cart.
   */
  swapEdition: (fromBookId: string, toBookId: string) => WriteResult;
  /** Validates `code` against the club's code, case-insensitively. */
  applyPromoCode: (code: string) => WriteResult;
  /** Sets the delivery-by date. Refuses a malformed or past date. */
  setDeliveryBy: (isoDate: string) => WriteResult;
  /** Saves a book for later. Idempotent — re-adding is still `ok: true`. */
  addToWishlist: (bookId: string) => WriteResult;
  /** Sets (replacing any existing) reminder for one book on one date. */
  setReminder: (bookId: string, isoDate: string) => WriteResult;
  /** Sets (not accumulates) store credit, in integer cents. */
  applyStoreCredit: (cents: number) => WriteResult;
}
