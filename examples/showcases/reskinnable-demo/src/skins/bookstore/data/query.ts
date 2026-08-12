import type {
  Book,
  BookQuery,
  CartLine,
  Format,
  Genre,
  SortKey,
} from "./types";
import type { BookClub } from "./club";

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

/** The inputs that can reduce a cart's total. All optional. */
export interface CartPricing {
  club?: BookClub;
  promoCode?: string;
  storeCreditCents?: number;
}

/**
 * Cart arithmetic.
 *
 * `pricing` is OPTIONAL and omitting it reproduces the original behaviour
 * exactly — `discountCents: 0` and `subtotalCents === totalCents`. Five call
 * sites pass two arguments; making the club required would break all of them.
 *
 * `subtotalCents` is the PRE-discount sum of `priceCents * qty` across the
 * cart. `totalCents` is `subtotalCents - discountCents` — the POST-discount
 * amount actually charged, and the field `use-data.ts` reads onto the `Order`
 * record. Rounding happens exactly once, inside `resolveDiscountCents`, whose
 * inputs are sanitised so it never returns a negative number itself;
 * `discountCents` is additionally floored at `subtotalCents` here. So
 * `subtotalCents - discountCents === totalCents` holds exactly and
 * `0 <= discountCents <= subtotalCents`, for any `pricing` — never negative,
 * never `NaN`, never fractional.
 *
 * `subtotalCents` exists now that a discount can make it differ from the
 * total. It was deliberately absent before: with no tax and no shipping the
 * two were identical, and a duplicated field can only drift.
 *
 * A line whose book is no longer in the catalog contributes nothing rather
 * than throwing — a stale `localStorage` cart from an older seed must not be
 * able to break the cart page.
 */
export function cartTotals(
  books: readonly Book[],
  cart: readonly CartLine[],
  pricing?: CartPricing,
): {
  itemCount: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
} {
  let itemCount = 0;
  let subtotalCents = 0;
  for (const line of cart) {
    const book = books.find((b) => b.id === line.bookId);
    if (!book) continue;
    itemCount += line.qty;
    subtotalCents += book.priceCents * line.qty;
  }

  const discountCents = Math.min(
    subtotalCents,
    resolveDiscountCents(subtotalCents, pricing),
  );

  return {
    itemCount,
    subtotalCents,
    discountCents,
    totalCents: subtotalCents - discountCents,
  };
}

/**
 * The club percentage (only when the supplied code actually matches the club's,
 * compared case-insensitively) plus any store credit. Rounded ONCE, here — the
 * single percentage boundary, same discipline as the dollars↔cents conversion.
 *
 * Both components are sanitised so this never returns a negative or non-finite
 * number itself: a negative `club.discountPercent` floors its contribution at
 * zero rather than producing a discount above the subtotal, and
 * `storeCreditCents` is coerced to a non-negative whole number, with any
 * non-finite value (`NaN`, `Infinity`) treated as zero. The caller still floors
 * the sum at the subtotal, for the upper bound.
 */
export function resolveDiscountCents(
  subtotalCents: number,
  pricing?: CartPricing,
): number {
  if (!pricing || subtotalCents <= 0) return 0;
  const { club, promoCode, storeCreditCents } = pricing;
  const codeMatches =
    club !== undefined &&
    promoCode !== undefined &&
    promoCode.trim().toLowerCase() === club.promoCode.toLowerCase();
  const percentCents =
    codeMatches && Number.isFinite(club.discountPercent)
      ? Math.max(0, Math.round((subtotalCents * club.discountPercent) / 100))
      : 0;
  const credit =
    storeCreditCents !== undefined && Number.isFinite(storeCreditCents)
      ? Math.max(0, Math.trunc(storeCreditCents))
      : 0;
  return percentCents + credit;
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
