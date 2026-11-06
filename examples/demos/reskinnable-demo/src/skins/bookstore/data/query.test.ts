import { describe, expect, it } from "vitest";
import { BOOKSTORE_BOOKS } from "./seed";
import {
  cartTotals,
  filterBooks,
  formatUsd,
  parseBookQuery,
  resolveDiscountCents,
} from "./query";
import type { CartPricing } from "./query";
import { BOOKSTORE_CLUB } from "./club";
import type { Book } from "./types";

const byId = (id: string): Book => {
  const book = BOOKSTORE_BOOKS.find((b) => b.id === id);
  if (!book) throw new Error(`no seed book ${id}`);
  return book;
};

describe("filterBooks", () => {
  it("returns every book for an empty query", () => {
    expect(filterBooks(BOOKSTORE_BOOKS, {})).toHaveLength(25);
  });

  it("filters by genre", () => {
    const out = filterBooks(BOOKSTORE_BOOKS, { genre: "poetry" });
    expect(out.map((b) => b.slug)).toEqual(["devotions", "time-is-a-mother"]);
  });

  it("filters by format", () => {
    const out = filterBooks(BOOKSTORE_BOOKS, {
      genre: "scifi",
      format: "paperback",
    });
    expect(out).toHaveLength(4);
    expect(out.every((b) => b.format === "paperback")).toBe(true);
  });

  it("treats maxCents as inclusive", () => {
    const out = filterBooks(BOOKSTORE_BOOKS, {
      genre: "literary",
      maxCents: 1899,
    });
    expect(out.map((b) => b.slug).sort()).toEqual([
      "a-little-life",
      "small-things-like-these",
      "the-overstory",
      "trust-paperback",
    ]);
  });

  it("combines genre, format and price — the beat-3c query", () => {
    const out = filterBooks(BOOKSTORE_BOOKS, {
      genre: "scifi",
      format: "paperback",
      sort: "price_asc",
    });
    expect(out.map((b) => b.slug)).toEqual([
      "the-three-body-problem",
      "a-memory-called-empire",
      "children-of-time",
      "project-hail-mary",
    ]);
  });

  it("sorts price_desc, rating_desc and newest", () => {
    const cheapestFirst = filterBooks(BOOKSTORE_BOOKS, { sort: "price_asc" });
    const dearestFirst = filterBooks(BOOKSTORE_BOOKS, { sort: "price_desc" });
    expect(dearestFirst[0].slug).toBe("the-books-of-jacob");
    expect(cheapestFirst[0].priceCents).toBeLessThan(
      dearestFirst[0].priceCents,
    );

    expect(filterBooks(BOOKSTORE_BOOKS, { sort: "rating_desc" })[0].slug).toBe(
      "devotions",
    );
    expect(filterBooks(BOOKSTORE_BOOKS, { sort: "newest" })[0].published).toBe(
      "2024",
    );
  });

  it("returns an empty array rather than throwing on an impossible query", () => {
    expect(
      filterBooks(BOOKSTORE_BOOKS, { genre: "poetry", maxCents: 1 }),
    ).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before = BOOKSTORE_BOOKS.map((b) => b.id);
    filterBooks(BOOKSTORE_BOOKS, { sort: "price_desc" });
    expect(BOOKSTORE_BOOKS.map((b) => b.id)).toEqual(before);
  });
});

describe("cartTotals", () => {
  it("is zero for an empty cart", () => {
    expect(cartTotals(BOOKSTORE_BOOKS, [])).toEqual({
      itemCount: 0,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });

  it("counts quantities and sums cents", () => {
    const a = byId("bk-005"); // 1400
    const b = byId("bk-012"); // 1299
    expect(
      cartTotals(BOOKSTORE_BOOKS, [
        { bookId: a.id, qty: 2 },
        { bookId: b.id, qty: 1 },
      ]),
    ).toEqual({
      itemCount: 3,
      subtotalCents: 1400 * 2 + 1299,
      discountCents: 0,
      totalCents: 1400 * 2 + 1299,
    });
  });

  it("ignores a line whose book is not in the catalog", () => {
    expect(cartTotals(BOOKSTORE_BOOKS, [{ bookId: "bk-999", qty: 3 }])).toEqual(
      { itemCount: 0, subtotalCents: 0, discountCents: 0, totalCents: 0 },
    );
  });
});

describe("cartTotals pricing", () => {
  const cart = [{ bookId: "bk-003", qty: 1 }]; // Trust hardcover, 2699

  it("is byte-for-byte today's behaviour when called with TWO arguments", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart);
    expect(t.itemCount).toBe(1);
    expect(t.subtotalCents).toBe(2699);
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(2699);
    expect(t.subtotalCents).toBe(t.totalCents);
  });

  it("applies the club percentage when the code matches", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: "CLUB15",
    });
    expect(t.discountCents).toBe(405); // round(2699 * 0.15)
    expect(t.totalCents).toBe(2294);
    expect(t.subtotalCents - t.discountCents).toBe(t.totalCents);
  });

  it("matches the code case-insensitively", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: "club15",
    });
    expect(t.discountCents).toBe(405);
  });

  it("ignores a code that is not the club's", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: BOOKSTORE_CLUB,
      promoCode: "NOPE99",
    });
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(2699);
  });

  it("ignores a code when no club is supplied", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { promoCode: "CLUB15" });
    expect(t.discountCents).toBe(0);
  });

  it("adds store credit to the discount", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { storeCreditCents: 500 });
    expect(t.discountCents).toBe(500);
    expect(t.totalCents).toBe(2199);
  });

  it("floors the discount at the subtotal — a total is never negative", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { storeCreditCents: 999_999 });
    expect(t.discountCents).toBe(2699);
    expect(t.totalCents).toBe(0);
  });

  it("is zero across the board for an empty cart", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, [], {
      club: BOOKSTORE_CLUB,
      promoCode: "CLUB15",
      storeCreditCents: 500,
    });
    expect(t).toEqual({
      itemCount: 0,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
    });
  });

  it("treats a NaN store credit as zero rather than letting NaN escape", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { storeCreditCents: NaN });
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(2699);
    expect(Number.isNaN(t.discountCents)).toBe(false);
    expect(Number.isNaN(t.totalCents)).toBe(false);
  });

  it("truncates a fractional store credit to whole cents", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { storeCreditCents: 250.7 });
    expect(t.discountCents).toBe(250);
    expect(t.totalCents).toBe(2449);
    expect(t.subtotalCents - t.discountCents).toBe(t.totalCents);
    expect(Number.isInteger(t.totalCents)).toBe(true);
  });

  it("treats a negative store credit as zero rather than adding to the total", () => {
    const t = cartTotals(BOOKSTORE_BOOKS, cart, { storeCreditCents: -100 });
    expect(t.discountCents).toBe(0);
    expect(t.totalCents).toBe(2699);
  });

  it("floors a negative club discountPercent at zero via resolveDiscountCents directly", () => {
    const negativeClub = { ...BOOKSTORE_CLUB, discountPercent: -50 };
    const discount = resolveDiscountCents(2699, {
      club: negativeClub,
      promoCode: "CLUB15",
    });
    expect(discount).toBe(0);
    expect(discount).toBeGreaterThanOrEqual(0);
    expect(discount).toBeLessThanOrEqual(2699);
  });

  it("treats a NaN club discountPercent as zero rather than letting NaN escape, via resolveDiscountCents directly", () => {
    const nanClub = { ...BOOKSTORE_CLUB, discountPercent: NaN };
    const discount = resolveDiscountCents(2699, {
      club: nanClub,
      promoCode: "CLUB15",
    });
    expect(discount).toBe(0);
    expect(Number.isNaN(discount)).toBe(false);
    expect(discount).toBeGreaterThanOrEqual(0);
    expect(discount).toBeLessThanOrEqual(2699);

    const t = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: nanClub,
      promoCode: "CLUB15",
    });
    expect(t.discountCents).toBe(0);
    expect(Number.isNaN(t.totalCents)).toBe(false);
    expect(t.subtotalCents - t.discountCents).toBe(t.totalCents);
  });

  it("treats an Infinity club discountPercent as zero rather than letting it escape, via resolveDiscountCents directly", () => {
    const infiniteClub = { ...BOOKSTORE_CLUB, discountPercent: Infinity };
    const discount = resolveDiscountCents(2699, {
      club: infiniteClub,
      promoCode: "CLUB15",
    });
    expect(discount).toBe(0);
    expect(Number.isFinite(discount)).toBe(true);
    expect(discount).toBeGreaterThanOrEqual(0);
    expect(discount).toBeLessThanOrEqual(2699);

    const t = cartTotals(BOOKSTORE_BOOKS, cart, {
      club: infiniteClub,
      promoCode: "CLUB15",
    });
    expect(t.discountCents).toBe(0);
    expect(Number.isFinite(t.totalCents)).toBe(true);
    expect(t.subtotalCents - t.discountCents).toBe(t.totalCents);
  });

  it("keeps subtotal minus discount exactly equal to total across pricing combinations", () => {
    const combos: (CartPricing | undefined)[] = [
      undefined,
      { club: BOOKSTORE_CLUB, promoCode: "CLUB15" },
      { storeCreditCents: 500 },
      { club: BOOKSTORE_CLUB, promoCode: "CLUB15", storeCreditCents: 500 },
      { club: BOOKSTORE_CLUB, promoCode: "CLUB15", storeCreditCents: 999_999 },
    ];
    for (const pricing of combos) {
      const t = cartTotals(BOOKSTORE_BOOKS, cart, pricing);
      expect(t.subtotalCents - t.discountCents).toBe(t.totalCents);
      expect(t.totalCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("parseBookQuery", () => {
  it("reads every lever off the URL", () => {
    const q = parseBookQuery(
      new URLSearchParams("genre=scifi&format=paperback&max=20&sort=price_asc"),
    );
    expect(q).toEqual({
      genre: "scifi",
      format: "paperback",
      maxCents: 2000,
      sort: "price_asc",
    });
  });

  it("drops values outside the known vocabularies", () => {
    expect(
      parseBookQuery(new URLSearchParams("genre=romance&sort=cheapest")),
    ).toEqual({});
  });

  it("ignores a non-numeric or negative max", () => {
    expect(parseBookQuery(new URLSearchParams("max=abc"))).toEqual({});
    expect(parseBookQuery(new URLSearchParams("max=-5"))).toEqual({});
  });

  it("accepts a fractional max in dollars", () => {
    expect(parseBookQuery(new URLSearchParams("max=17.50")).maxCents).toBe(
      1750,
    );
  });

  it("returns an empty query for an empty search string", () => {
    expect(parseBookQuery(new URLSearchParams(""))).toEqual({});
  });
});

describe("formatUsd", () => {
  it("renders whole and fractional dollars", () => {
    expect(formatUsd(1899)).toBe("$18.99");
    expect(formatUsd(1400)).toBe("$14.00");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(3500)).toBe("$35.00");
  });
});
