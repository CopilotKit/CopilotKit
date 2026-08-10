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
   * and order identity, never on timers, so readables do not re-register on
   * every highlight tick.
   */
  cartSignature: string;
}
