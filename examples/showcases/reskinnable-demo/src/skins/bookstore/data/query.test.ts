import { describe, expect, it } from "vitest";
import { BOOKSTORE_BOOKS } from "./seed";
import { cartTotals, filterBooks, formatUsd, parseBookQuery } from "./query";
import type { Book } from "./types";

const byId = (id: string): Book => {
  const book = BOOKSTORE_BOOKS.find((b) => b.id === id);
  if (!book) throw new Error(`no seed book ${id}`);
  return book;
};

describe("filterBooks", () => {
  it("returns every book for an empty query", () => {
    expect(filterBooks(BOOKSTORE_BOOKS, {})).toHaveLength(24);
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
    ).toEqual({ itemCount: 3, totalCents: 1400 * 2 + 1299 });
  });

  it("ignores a line whose book is not in the catalog", () => {
    expect(cartTotals(BOOKSTORE_BOOKS, [{ bookId: "bk-999", qty: 3 }])).toEqual(
      { itemCount: 0, totalCents: 0 },
    );
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
