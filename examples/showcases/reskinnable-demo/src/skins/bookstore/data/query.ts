import type {
  Book,
  BookQuery,
  CartLine,
  Format,
  Genre,
  SortKey,
} from "./types";

/**
 * Every pure derivation the skin needs. No React, no store access — so the
 * pages, the tools and the tests all agree about what a query MEANS, and the
 * agent-facing readables cannot disagree with what the grid renders.
 */

const GENRES: readonly Genre[] = [
  "literary",
  "translated",
  "scifi",
  "mystery",
  "history",
  "poetry",
];
const FORMATS: readonly Format[] = ["paperback", "hardcover", "ebook"];
const SORTS: readonly SortKey[] = [
  "price_asc",
  "price_desc",
  "rating_desc",
  "newest",
];

export const BOOK_GENRES = GENRES;
export const BOOK_FORMATS = FORMATS;
export const BOOK_SORTS = SORTS;

/** Human labels for the levers, shared by FilterBar and NavigateConfirmCard. */
export const SORT_LABELS: Record<SortKey, string> = {
  price_asc: "Price, low to high",
  price_desc: "Price, high to low",
  rating_desc: "Highest rated",
  newest: "Newest first",
};

export const GENRE_LABELS: Record<Genre, string> = {
  literary: "Literary fiction",
  translated: "Translated fiction",
  scifi: "Science fiction",
  mystery: "Mystery",
  history: "History",
  poetry: "Poetry",
};

/** `1899` → `"$18.99"`. The ONLY place cents become a string. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Filter then sort. Returns a NEW array — callers rely on the seed order
 * staying stable.
 *
 * `maxCents` is INCLUSIVE: "nothing over $20" must keep a $20.00 book, which is
 * how Maya's seeded preference reads in plain English.
 */
export function filterBooks(books: readonly Book[], query: BookQuery): Book[] {
  const { genre, format, maxCents, sort } = query;

  const out = books.filter((book) => {
    if (genre && book.genre !== genre) return false;
    if (format && book.format !== format) return false;
    if (maxCents !== undefined && book.priceCents > maxCents) return false;
    return true;
  });

  switch (sort) {
    case "price_asc":
      return out.sort((a, b) => a.priceCents - b.priceCents);
    case "price_desc":
      return out.sort((a, b) => b.priceCents - a.priceCents);
    case "rating_desc":
      return out.sort((a, b) => b.rating - a.rating);
    case "newest":
      return out.sort((a, b) => Number(b.published) - Number(a.published));
    default:
      return out;
  }
}

/**
 * Cart arithmetic. Returns `{ itemCount, totalCents }` and deliberately NOT a
 * separate subtotal: this skin has no tax and no shipping (spec §10), so a
 * subtotal field would be a duplicate of the total that a future edit could
 * silently let drift.
 *
 * A line whose book is no longer in the catalog contributes nothing rather
 * than throwing — a stale `localStorage` cart from an older seed must not be
 * able to break the cart page.
 */
export function cartTotals(
  books: readonly Book[],
  cart: readonly CartLine[],
): { itemCount: number; totalCents: number } {
  let itemCount = 0;
  let totalCents = 0;
  for (const line of cart) {
    const book = books.find((b) => b.id === line.bookId);
    if (!book) continue;
    itemCount += line.qty;
    totalCents += book.priceCents * line.qty;
  }
  return { itemCount, totalCents };
}

/**
 * Read the browse levers off the URL. Unknown values are DROPPED rather than
 * defaulted, so `?genre=romance` renders the unfiltered shelf instead of an
 * empty one — and so the agent cannot invent a lever the UI would then claim
 * to have applied.
 *
 * `max` is in DOLLARS in the URL (`?max=20`) because a presenter reads that
 * URL aloud; it becomes cents here, at the single boundary.
 */
export function parseBookQuery(params: URLSearchParams): BookQuery {
  const query: BookQuery = {};

  const genre = params.get("genre");
  if (genre && (GENRES as readonly string[]).includes(genre)) {
    query.genre = genre as Genre;
  }

  const format = params.get("format");
  if (format && (FORMATS as readonly string[]).includes(format)) {
    query.format = format as Format;
  }

  const max = params.get("max");
  if (max !== null && max.trim() !== "") {
    const dollars = Number(max);
    if (Number.isFinite(dollars) && dollars >= 0) {
      query.maxCents = Math.round(dollars * 100);
    }
  }

  const sort = params.get("sort");
  if (sort && (SORTS as readonly string[]).includes(sort)) {
    query.sort = sort as SortKey;
  }

  return query;
}

/** The inverse of `parseBookQuery` — used by FilterBar and browseWithFilters. */
export function bookQueryToParams(query: BookQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.genre) params.set("genre", query.genre);
  if (query.format) params.set("format", query.format);
  if (query.maxCents !== undefined) {
    params.set("max", (query.maxCents / 100).toFixed(2).replace(/\.00$/, ""));
  }
  if (query.sort) params.set("sort", query.sort);
  return params;
}
